/**
 * App state: the profile (groups joined, keys), its optional passphrase
 * lock, one live session per group, and the current screen (from the URL).
 *
 * One tab at a time: two tabs would each hold the profile and overwrite each
 * other's saves (a group joined in one could vanish), so a Web Lock picks the
 * active tab; another one offers to take over.
 */
import { signal } from "@preact/signals";
import { newVaultKey, openVault, sealVault, type VaultKey } from "../crypto/vault";
import { fromUtf8, utf8 } from "../lib/bytes";
import { type Invitation, parseInvite } from "../model/codes";
import { foundGroup, type GroupRecord, GroupSession, joinRecord } from "../model/session";
import { IdbStore, MemoryStore, type Store } from "../model/store";
import { ringChecker } from "./ring-worker";
import { type GroupTab, hashToRoute, type Route, routeToHash } from "./router";
import { iceServers, settings, signalConfig } from "./settings";

export type { GroupTab, Route };

interface Profile {
  v: 1;
  groups: GroupRecord[];
}

const LOCKED_FLAG = "agora.locked";
const TAKEOVER_FLAG = "agora.takeover";

export const phase = signal<"loading" | "locked" | "ready" | "error" | "elsewhere">("loading");
export const route = signal<Route>({ name: "home" });
export const groups = signal<GroupRecord[]>([]);
export const locked = signal(false);
/** Bumped when a session starts or stops (the screens read sessions through it). */
export const sessionsVersion = signal(0);
/** The last save failed (storage full or unavailable): shown, so nothing is lost silently. */
export const saveError = signal(false);

const store: Store = typeof indexedDB === "undefined" ? new MemoryStore() : new IdbStore();
const sessions = new Map<string, GroupSession>();
let vaultKey: VaultKey | null = null;
let ringCheck: ReturnType<typeof ringChecker> | null = null;
/** An invitation read from the address bar, waiting on the join screen. */
let pendingInvite: Invitation | null = null;

// ---------------------------------------------------------------------------
// Navigation

function titleOf(r: Route): string {
  if (r.name === "group") {
    const name = groups.value.find((g) => g.id === r.id)?.name;
    if (name) return `${name} · agora`;
  }
  return "agora";
}

/** Shows `r` and records it in the history (or replaces the current entry). */
export function go(r: Route, opts: { replace?: boolean } = {}): void {
  route.value = r;
  document.title = titleOf(r);
  const hash = routeToHash(r);
  if (location.hash !== hash) {
    if (opts.replace) history.replaceState(null, "", hash);
    else history.pushState(null, "", hash);
  }
  window.scrollTo?.(0, 0);
}

/** The screen the address bar names (back, forward, a link, a reload). */
function fromLocation(): void {
  const invite = parseInvite(location.hash);
  if (invite) {
    // The secret leaves the address bar (and the history) at once.
    history.replaceState(null, "", "#/join");
    const existing = groups.value.find((g) => g.genesisId === invite.genesisId);
    if (existing) {
      go({ name: "group", id: existing.id }, { replace: true });
    } else {
      pendingInvite = invite;
      route.value = { name: "join", invite };
      document.title = "agora";
    }
    return;
  }
  const r = hashToRoute(location.hash);
  if (!r) {
    go({ name: "home" }, { replace: true });
    return;
  }
  if (r.name === "join" && pendingInvite) r.invite = pendingInvite;
  route.value = r;
  document.title = titleOf(r);
}

export function session(id: string): GroupSession | undefined {
  return sessions.get(id);
}

// ---------------------------------------------------------------------------
// Boot, lock, tab

function flag(key: string): boolean {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

interface LockManagerLike {
  request(
    name: string,
    opts: { ifAvailable?: boolean; steal?: boolean },
    fn: (lock: unknown) => Promise<void> | undefined,
  ): Promise<void>;
}

/** Holds the one-active-tab lock; false when another tab has it. */
function claimTab(): Promise<boolean> {
  const locks = (navigator as { locks?: LockManagerLike }).locks;
  if (!locks) return Promise.resolve(true);
  let steal = false;
  try {
    steal = sessionStorage.getItem(TAKEOVER_FLAG) === "1";
    sessionStorage.removeItem(TAKEOVER_FLAG);
  } catch {
    // no storage
  }
  return new Promise((resolve) => {
    locks
      .request("agora-active-tab", steal ? { steal: true } : { ifAvailable: true }, (held) => {
        if (!held) {
          resolve(false);
          return undefined;
        }
        resolve(true);
        return new Promise<void>(() => {}); // held for the life of the tab
      })
      .catch(() => {
        // Another tab took over: stop here, without touching the profile again.
        for (const s of sessions.values()) s.close();
        sessions.clear();
        phase.value = "elsewhere";
      });
  });
}

/** From the "open in another tab" screen: make this tab the active one. */
export function takeOver(): void {
  try {
    sessionStorage.setItem(TAKEOVER_FLAG, "1");
  } catch {
    // no storage: the reload asks again
  }
  location.reload();
}

export async function boot(): Promise<void> {
  window.addEventListener("hashchange", fromLocation);
  window.addEventListener("popstate", fromLocation);
  try {
    if (!(await claimTab())) {
      phase.value = "elsewhere";
      return;
    }
    const blob = await store.loadProfile();
    if (blob && flag(LOCKED_FLAG)) {
      locked.value = true;
      phase.value = "locked";
      return;
    }
    open(blob);
  } catch {
    phase.value = "error";
  }
}

/** Unlocks with the passphrase; false if it is wrong. */
export async function unlock(pass: string): Promise<boolean> {
  const blob = await store.loadProfile();
  if (!blob) return false;
  try {
    const { data, vk } = await openVault(pass, blob);
    vaultKey = vk;
    open(data);
    return true;
  } catch {
    return false;
  }
}

function open(plain: Uint8Array | null): void {
  let profile: Profile = { v: 1, groups: [] };
  if (plain) {
    try {
      profile = JSON.parse(fromUtf8(plain)) as Profile;
    } catch {
      profile = { v: 1, groups: [] };
    }
  }
  groups.value = profile.groups ?? [];
  ringCheck = ringChecker();
  // Sessions load and sync in the background: the screens show them as they fill in.
  for (const rec of groups.value) void startSession(rec);
  phase.value = "ready";
  fromLocation();
}

function startSession(rec: GroupRecord): Promise<GroupSession> {
  const s = new GroupSession(
    rec,
    store,
    {
      signal: signalConfig(),
      iceServers: iceServers(),
      relayOnly: settings.value.relayOnly,
      ...(ringCheck ? { ringCheck } : {}),
    },
    { onRecord: (r) => updateRecord(r) },
  );
  sessions.set(rec.id, s);
  sessionsVersion.value++;
  return s.start().then(() => s);
}

function updateRecord(rec: GroupRecord): void {
  if (!groups.value.some((g) => g.id === rec.id)) return;
  groups.value = groups.value.map((g) => (g.id === rec.id ? rec : g));
  void save().catch(() => {});
}

let saving: Promise<void> = Promise.resolve();

/** Saves the profile (sealed with the vault key when locked). One failure never blocks the next. */
export function save(): Promise<void> {
  const next = saving.then(async () => {
    const plain = utf8(JSON.stringify({ v: 1, groups: groups.value } satisfies Profile));
    await store.saveProfile(vaultKey ? sealVault(vaultKey, plain) : plain);
    saveError.value = false;
  });
  saving = next.catch(() => {
    saveError.value = true;
  });
  return next;
}

/** Sets, changes or (null) removes the passphrase. */
export async function setPassphrase(pass: string | null): Promise<void> {
  vaultKey = pass ? await newVaultKey(pass) : null;
  locked.value = pass !== null;
  try {
    if (pass) localStorage.setItem(LOCKED_FLAG, "1");
    else localStorage.removeItem(LOCKED_FLAG);
  } catch {
    // no storage: the profile stays as it is written below
  }
  await save();
}

// ---------------------------------------------------------------------------
// Groups

export async function createGroup(opts: {
  name: string;
  about: string;
  vouches: number;
  organizer: boolean;
  memberName: string;
}): Promise<string> {
  const { record, genesis } = foundGroup({
    ...opts,
    ...(opts.memberName ? { memberName: opts.memberName } : {}),
  });
  groups.value = [...groups.value, record];
  await save();
  const s = await startSession(record);
  await s.publish(genesis);
  return record.id;
}

export async function joinGroup(invite: Invitation, memberName: string): Promise<string> {
  pendingInvite = null;
  const existing = groups.value.find((g) => g.genesisId === invite.genesisId);
  if (existing) return existing.id;
  const record = joinRecord(invite, memberName || undefined);
  groups.value = [...groups.value, record];
  await save();
  void startSession(record);
  return record.id;
}

export async function leaveGroup(id: string): Promise<void> {
  sessions.get(id)?.close();
  sessions.delete(id);
  sessionsVersion.value++;
  groups.value = groups.value.filter((g) => g.id !== id);
  await store.forget(id);
  await save();
}

/** Restarts every session (after the network settings changed). */
export function restartSessions(): void {
  for (const s of sessions.values()) s.close();
  sessions.clear();
  for (const rec of groups.value) void startSession(rec);
}

export async function wipeAll(): Promise<void> {
  for (const s of sessions.values()) s.close();
  sessions.clear();
  await Promise.race([store.wipe(), new Promise((r) => setTimeout(r, 3000))]);
  try {
    localStorage.clear();
  } catch {
    // nothing kept
  }
  location.replace(location.pathname);
}
