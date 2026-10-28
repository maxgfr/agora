/**
 * App state: the profile (groups joined, keys), its optional passphrase
 * lock, one live session per group, and the current screen.
 */
import { signal } from "@preact/signals";
import { lock, unlock as unlockVault } from "../crypto/vault";
import { fromUtf8, utf8 } from "../lib/bytes";
import { type Invitation, parseInvite } from "../model/codes";
import { foundGroup, type GroupRecord, GroupSession, joinRecord } from "../model/session";
import { IdbStore, MemoryStore, type Store } from "../model/store";
import { ringChecker } from "./ring-worker";
import { iceServers, settings, signalConfig } from "./settings";

export type Route =
  | { name: "home" }
  | { name: "create" }
  | { name: "join"; invite?: Invitation }
  | { name: "group"; id: string; tab?: GroupTab; item?: string }
  | { name: "settings" };

export type GroupTab = "polls" | "actions" | "members" | "invite";

interface Profile {
  v: 1;
  groups: GroupRecord[];
}

const LOCKED_FLAG = "agora.locked";

export const phase = signal<"loading" | "locked" | "ready" | "error">("loading");
export const route = signal<Route>({ name: "home" });
export const groups = signal<GroupRecord[]>([]);
export const locked = signal(false);
/** Bumped when a session starts or stops (the screens read sessions through it). */
export const sessionsVersion = signal(0);

const store: Store = typeof indexedDB === "undefined" ? new MemoryStore() : new IdbStore();
const sessions = new Map<string, GroupSession>();
let passphrase: string | null = null;
let ringCheck: ReturnType<typeof ringChecker> | null = null;

export function go(r: Route): void {
  route.value = r;
  if (typeof window !== "undefined") window.scrollTo?.(0, 0);
}

export function session(id: string): GroupSession | undefined {
  return sessions.get(id);
}

function isLockedFlag(): boolean {
  try {
    return localStorage.getItem(LOCKED_FLAG) === "1";
  } catch {
    return false;
  }
}

export async function boot(): Promise<void> {
  try {
    const blob = await store.loadProfile();
    if (blob && isLockedFlag()) {
      locked.value = true;
      phase.value = "locked";
      return;
    }
    await open(blob);
  } catch {
    phase.value = "error";
  }
}

/** Unlocks with the passphrase; false if it is wrong. */
export async function unlock(pass: string): Promise<boolean> {
  const blob = await store.loadProfile();
  if (!blob) return false;
  try {
    const plain = await unlockVault(pass, blob);
    passphrase = pass;
    await open(plain, true);
    return true;
  } catch {
    return false;
  }
}

async function open(plain: Uint8Array | null, decrypted = false): Promise<void> {
  let profile: Profile = { v: 1, groups: [] };
  if (plain && (decrypted || !isLockedFlag())) {
    try {
      profile = JSON.parse(fromUtf8(plain)) as Profile;
    } catch {
      profile = { v: 1, groups: [] };
    }
  }
  groups.value = profile.groups ?? [];
  ringCheck = ringChecker();
  for (const rec of groups.value) await startSession(rec);
  phase.value = "ready";
  consumeInviteFragment();
  window.addEventListener?.("hashchange", consumeInviteFragment);
}

/** An invitation in the address bar becomes the join screen; the secret leaves the URL. */
function consumeInviteFragment(): void {
  if (typeof location === "undefined" || !location.hash) return;
  const invite = parseInvite(location.hash);
  if (!invite) return;
  history.replaceState(null, "", location.pathname + location.search);
  const existing = groups.value.find((g) => g.genesisId === invite.genesisId);
  go(existing ? { name: "group", id: existing.id } : { name: "join", invite });
}

async function startSession(rec: GroupRecord): Promise<GroupSession> {
  const verdicts = await store.verdicts(rec.id);
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
    verdicts,
  );
  sessions.set(rec.id, s);
  sessionsVersion.value++;
  await s.start();
  return s;
}

function updateRecord(rec: GroupRecord): void {
  groups.value = groups.value.map((g) => (g.id === rec.id ? rec : g));
  void save();
}

let saving: Promise<void> = Promise.resolve();

export function save(): Promise<void> {
  saving = saving.then(async () => {
    const plain = utf8(JSON.stringify({ v: 1, groups: groups.value } satisfies Profile));
    await store.saveProfile(passphrase ? await lock(passphrase, plain) : plain);
  });
  return saving;
}

/** Sets, changes or (null) removes the passphrase. */
export async function setPassphrase(pass: string | null): Promise<void> {
  passphrase = pass;
  locked.value = pass !== null;
  try {
    if (pass) localStorage.setItem(LOCKED_FLAG, "1");
    else localStorage.removeItem(LOCKED_FLAG);
  } catch {
    // no storage: the profile stays as it is written below
  }
  await save();
}

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
  const existing = groups.value.find((g) => g.genesisId === invite.genesisId);
  if (existing) return existing.id;
  const record = joinRecord(invite, memberName || undefined);
  groups.value = [...groups.value, record];
  await save();
  await startSession(record);
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
export async function restartSessions(): Promise<void> {
  for (const s of sessions.values()) s.close();
  sessions.clear();
  for (const rec of groups.value) await startSession(rec);
}

export async function wipeAll(): Promise<void> {
  for (const s of sessions.values()) s.close();
  sessions.clear();
  await store.wipe();
  try {
    localStorage.clear();
  } catch {
    // nothing kept
  }
  location.replace(location.pathname);
}
