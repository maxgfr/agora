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

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export class IdbStore implements Store {
  private db: Promise<IDBDatabase> | null = null;

  private open(): Promise<IDBDatabase> {
    this.db ??= new Promise((resolve, reject) => {
      const r = indexedDB.open(DB, VERSION);
      r.onupgradeneeded = () => {
        const db = r.result;
        db.createObjectStore("profile");
        db.createObjectStore("wires", { keyPath: ["g", "id"] }).createIndex("g", "g");
        db.createObjectStore("verdicts", { keyPath: ["g", "id"] }).createIndex("g", "g");
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    return this.db;
  }

  private async tx(store: string, mode: IDBTransactionMode) {
    return (await this.open()).transaction(store, mode).objectStore(store);
  }

  async loadProfile() {
    const v = await req((await this.tx("profile", "readonly")).get("me"));
    return v instanceof Uint8Array ? v : null;
  }
  async saveProfile(blob: Uint8Array) {
    await req((await this.tx("profile", "readwrite")).put(blob, "me"));
  }
  async wires(g: string) {
    const rows = await req((await this.tx("wires", "readonly")).index("g").getAll(g));
    return (rows as { wire: string }[]).map((r) => r.wire);
  }
  async addWire(g: string, id: string, wire: string) {
    await req((await this.tx("wires", "readwrite")).put({ g, id, wire }));
  }
  async verdicts(g: string) {
    const rows = await req((await this.tx("verdicts", "readonly")).index("g").getAll(g));
    return (rows as { id: string; ok: boolean }[]).map((r) => [r.id, r.ok] as [string, boolean]);
  }
  async setVerdict(g: string, id: string, ok: boolean) {
    await req((await this.tx("verdicts", "readwrite")).put({ g, id, ok }));
  }
  async forget(g: string) {
    for (const name of ["wires", "verdicts"]) {
      const store = await this.tx(name, "readwrite");
      const keys = await req(store.index("g").getAllKeys(g));
      for (const k of keys) store.delete(k);
    }
  }
  async wipe() {
    (await this.open()).close();
    this.db = null;
    await req(indexedDB.deleteDatabase(DB));
  }
}
