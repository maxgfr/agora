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
import { classifyCode, type Invitation, parseInvite } from "../model/codes";
import type { MemberCard } from "../model/events";
import { foundGroup, type GroupRecord, GroupSession, joinRecord } from "../model/session";
import { IdbStore, MemoryStore, type Store } from "../model/store";
import type { Key } from "../ui/i18n";
import { diag, startDiagnostics, storageError } from "./diag";
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

const idb = typeof indexedDB === "undefined" ? null : new IdbStore();
const store: Store = idb ?? new MemoryStore();
if (idb)
  idb.onError = (err) => {
    storageError(err);
    saveError.value = true;
  };
const sessions = new Map<string, GroupSession>();
let vaultKey: VaultKey | null = null;
let ringCheck: ReturnType<typeof ringChecker> | null = null;
/** An invitation read from the address bar, waiting on the join screen. */
let pendingInvite: Invitation | null = null;

/** What the app's scanner read, for the screen it opened to pick up. */
export type ScanIntent =
  | { groupId: string; kind: "card"; card: MemberCard }
  | { groupId: string; kind: "request"; text: string }
  | { groupId: string; kind: "answer"; text: string }
  | { groupId: string; kind: "organizer"; text: string };

export const scanIntent = signal<ScanIntent | null>(null);
export const scanOpen = signal(false);

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
    openInvite(invite, true);
    return;
  }
  const r = hashToRoute(location.hash);
  if (!r) {
    go({ name: "home" }, { replace: true });
    return;
  }
  if (r.name === "join" && pendingInvite) r.invite = pendingInvite;
  // An older spelling of the same screen (#/g/…/invite): show the current one.
  if (r.name !== "join" && routeToHash(r) !== location.hash && location.hash.length > 1)
    history.replaceState(null, "", routeToHash(r));
  route.value = r;
  document.title = titleOf(r);
}

export function session(id: string): GroupSession | undefined {
  return sessions.get(id);
}

/** Opens an invitation: its group if already joined, else the join screen. */
function openInvite(invite: Invitation, replace: boolean): void {
  const existing = groups.value.find((g) => g.genesisId === invite.genesisId);
  if (existing) {
    go({ name: "group", id: existing.id }, { replace });
    return;
  }
  pendingInvite = invite;
  route.value = { name: "join", invite };
  document.title = "agora";
  if (location.hash !== "#/join") {
    if (replace) history.replaceState(null, "", "#/join");
    else history.pushState(null, "", "#/join");
  }
}

/**
 * Takes any agora code from the scanner and opens what it is for: an invitation joins, a card
 * goes to vouching, a ticket request to the organizer's desk, an answer to one's admission.
 * Returns an error message key, or null when it was handled.
 */
export function handleScan(text: string): Key | null {
  const code = classifyCode(text);
  if (!code) return "codeUnknown";
  if (code.kind === "invite") {
    openInvite(code.invite, false);
    return null;
  }
  const groupId = code.code.groupId;
  const fits = (rec: GroupRecord): boolean => {
    const view = sessions.get(rec.id)?.view.value;
    if (code.kind === "card") return !!view?.me && (view.policy?.vouches ?? 0) > 0;
    if (code.kind === "request") return !!rec.organizer?.length;
    if (code.kind === "answer") return !!rec.ticket;
    return (view?.policy?.issuers.length ?? 0) > 0;
  };
  let rec: GroupRecord | undefined;
  if (groupId) {
    rec = groups.value.find((g) => g.id === groupId);
    if (!rec) return "codeOtherGroup";
    if (!fits(rec))
      return code.kind === "card"
        ? "notMemberThere"
        : code.kind === "request"
          ? "notOrganizerThere"
          : code.kind === "answer"
            ? "noTicketPending"
            : "invalidOrganizer";
  } else {
    // A version 1 code names no group: only unambiguous if one group fits.
    const candidates = groups.value.filter(fits);
    if (candidates.length !== 1) return "openGroupFirst";
    rec = candidates[0] as GroupRecord;
  }
  scanIntent.value =
    code.kind === "card"
      ? { groupId: rec.id, kind: "card", card: code.code.value }
      : ({ groupId: rec.id, kind: code.kind, text } as ScanIntent);
  // Cards, ticket requests and organizer keys are all handled in the members tab.
  go(
    code.kind === "answer"
      ? { name: "group", id: rec.id }
      : { name: "group", id: rec.id, tab: "members" },
  );
  return null;
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

/**
 * Coming back to the page: after the browser froze it (back-forward cache, a phone that slept,
 * a tab left in the background), its WebSockets may be dead without having said so. Reconnect
 * instead of showing a group that silently stopped updating.
 */
function watchLifecycle(): void {
  let hiddenAt = 0;
  const revive = () => {
    if (phase.value !== "ready") return;
    diag.reconnects++;
    void restartSessions();
  };
  window.addEventListener("pageshow", (e) => {
    if (e.persisted) revive();
  });
  window.addEventListener("online", revive);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      hiddenAt = Date.now();
      void idb?.flush();
    } else if (hiddenAt && Date.now() - hiddenAt > 2 * 60_000) revive();
  });
  // Queued writes go out before the page goes away.
  window.addEventListener("pagehide", () => void idb?.flush());
}

export async function boot(): Promise<void> {
  window.addEventListener("hashchange", fromLocation);
  window.addEventListener("popstate", fromLocation);
  startDiagnostics();
  watchLifecycle();
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
  saving = next.catch((err) => {
    storageError(err);
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

/** Restarts every session (network settings changed, or the page came back from sleep). */
export async function restartSessions(): Promise<void> {
  for (const s of sessions.values()) s.close();
  sessions.clear();
  // What the old sessions queued is written before the new ones read it back.
  await idb?.flush();
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
