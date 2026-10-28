/**
 * What a device keeps: its profile (groups joined, member seeds, organizer
 * keys: one opaque blob, locked by the vault when a passphrase is set), and
 * per group the sealed events seen and the verdicts of their signatures.
 * Sealed events are kept as they travel (ciphertext), so the store holds
 * nothing readable beyond the profile.
 */

export interface Store {
  loadProfile(): Promise<Uint8Array | null>;
  saveProfile(blob: Uint8Array): Promise<void>;
  wires(group: string): Promise<string[]>;
  addWire(group: string, id: string, wire: string): Promise<void>;
  verdicts(group: string): Promise<[string, boolean][]>;
  setVerdict(group: string, id: string, ok: boolean): Promise<void>;
  forget(group: string): Promise<void>;
  wipe(): Promise<void>;
}

export class MemoryStore implements Store {
  profile: Uint8Array | null = null;
  readonly groups = new Map<
    string,
    { wires: Map<string, string>; verdicts: Map<string, boolean> }
  >();

  private group(g: string) {
    let s = this.groups.get(g);
    if (!s) {
      s = { wires: new Map(), verdicts: new Map() };
      this.groups.set(g, s);
    }
    return s;
  }

  async loadProfile() {
    return this.profile;
  }
  async saveProfile(blob: Uint8Array) {
    this.profile = blob;
  }
  async wires(g: string) {
    return [...this.group(g).wires.values()];
  }
  async addWire(g: string, id: string, wire: string) {
    this.group(g).wires.set(id, wire);
  }
  async verdicts(g: string) {
    return [...this.group(g).verdicts];
  }
  async setVerdict(g: string, id: string, ok: boolean) {
    this.group(g).verdicts.set(id, ok);
  }
  async forget(g: string) {
    this.groups.delete(g);
  }
  async wipe() {
    this.profile = null;
    this.groups.clear();
  }
}

const DB = "agora";
const VERSION = 1;
/** Longest an IndexedDB call may take before it counts as failed (Safari can hang one forever). */
export const IDB_TIMEOUT_MS = 5000;
/** Writes of sealed events and verdicts are grouped into one transaction this often. */
const FLUSH_MS = 150;

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("transaction aborted"));
  });
}

export function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${what}: storage did not answer`)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/**
 * IndexedDB, defensively: every call has a deadline (a hung request fails instead of freezing
 * what waits on it), a connection the browser closed (Safari does, after the page sat in the
 * background) is reopened, and event and verdict writes are batched into one transaction.
 */
export class IdbStore implements Store {
  private db: Promise<IDBDatabase> | null = null;
  private queue: { store: "wires" | "verdicts"; value: Record<string, unknown> }[] = [];
  private flushing: ReturnType<typeof setTimeout> | undefined;
  /** Called when a write is lost (the screen shows that storage failed). */
  onError?: (err: unknown) => void;

  private open(): Promise<IDBDatabase> {
    this.db ??= new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open(DB, VERSION);
      r.onupgradeneeded = () => {
        const db = r.result;
        db.createObjectStore("profile");
        db.createObjectStore("wires", { keyPath: ["g", "id"] }).createIndex("g", "g");
        db.createObjectStore("verdicts", { keyPath: ["g", "id"] }).createIndex("g", "g");
      };
      r.onsuccess = () => {
        const db = r.result;
        // Closed under us (backgrounded tab, storage pressure, another tab's upgrade): reopen.
        db.onclose = () => {
          this.db = null;
        };
        db.onversionchange = () => {
          db.close();
          this.db = null;
        };
        resolve(db);
      };
      r.onerror = () => reject(r.error);
      r.onblocked = () => reject(new Error("storage blocked by another tab"));
    }).catch((err) => {
      this.db = null;
      throw err;
    });
    return this.db;
  }

  /** Runs `fn` in a transaction, with a deadline; retries once on a connection found closed. */
  private async run<T>(
    stores: string | string[],
    mode: IDBTransactionMode,
    fn: (tx: IDBTransaction) => Promise<T>,
    what: string,
  ): Promise<T> {
    const attempt = async () => {
      const db = await this.open();
      const tx = db.transaction(stores, mode);
      const [result] = await Promise.all([fn(tx), done(tx)]);
      return result;
    };
    try {
      return await withTimeout(attempt(), IDB_TIMEOUT_MS, what);
    } catch (err) {
      this.db = null;
      if (err instanceof DOMException && err.name === "InvalidStateError")
        return withTimeout(attempt(), IDB_TIMEOUT_MS, what);
      throw err;
    }
  }

  private enqueue(store: "wires" | "verdicts", value: Record<string, unknown>): void {
    this.queue.push({ store, value });
    this.flushing ??= setTimeout(() => void this.flush(), FLUSH_MS);
  }

  /** Writes what is queued, in one transaction. */
  async flush(): Promise<void> {
    clearTimeout(this.flushing);
    this.flushing = undefined;
    const batch = this.queue;
    this.queue = [];
    if (batch.length === 0) return;
    try {
      await this.run(
        ["wires", "verdicts"],
        "readwrite",
        async (tx) => {
          for (const w of batch) tx.objectStore(w.store).put(w.value);
        },
        "write",
      );
    } catch (err) {
      this.onError?.(err);
    }
  }

  async loadProfile() {
    const v = await this.run(
      "profile",
      "readonly",
      (tx) => req(tx.objectStore("profile").get("me")),
      "profile",
    );
    return v instanceof Uint8Array ? v : null;
  }
  async saveProfile(blob: Uint8Array) {
    await this.run(
      "profile",
      "readwrite",
      async (tx) => {
        tx.objectStore("profile").put(blob, "me");
      },
      "save",
    );
  }
  async wires(g: string) {
    const rows = await this.run(
      "wires",
      "readonly",
      (tx) => req(tx.objectStore("wires").index("g").getAll(g)),
      "events",
    );
    return (rows as { wire: string }[]).map((r) => r.wire);
  }
  async addWire(g: string, id: string, wire: string) {
    this.enqueue("wires", { g, id, wire });
  }
  async verdicts(g: string) {
    const rows = await this.run(
      "verdicts",
      "readonly",
      (tx) => req(tx.objectStore("verdicts").index("g").getAll(g)),
      "verdicts",
    );
    return (rows as { id: string; ok: boolean }[]).map((r) => [r.id, r.ok] as [string, boolean]);
  }
  async setVerdict(g: string, id: string, ok: boolean) {
    this.enqueue("verdicts", { g, id, ok });
  }
  async forget(g: string) {
    await this.flush();
    await this.run(
      ["wires", "verdicts"],
      "readwrite",
      async (tx) => {
        for (const name of ["wires", "verdicts"]) {
          const store = tx.objectStore(name);
          const keys = await req(store.index("g").getAllKeys(g));
          for (const k of keys) store.delete(k);
        }
      },
      "forget",
    );
  }
  async wipe() {
    this.queue = [];
    clearTimeout(this.flushing);
    const db = await this.db?.catch(() => null);
    db?.close();
    this.db = null;
    await withTimeout(req(indexedDB.deleteDatabase(DB)), IDB_TIMEOUT_MS, "wipe");
  }
}
