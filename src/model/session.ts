/**
 * One group, live: its sealed events (from the store, the relays and the
 * peers), their verification, the folded view, and what this member does in
 * it. Every sealed event takes the same path whatever brought it: stored,
 * opened if a held key fits (kept for later otherwise), checked, folded.
 */
import { signal } from "@preact/signals";
import { type Issuer, issuerFromSecret, newIssuer, signBlinded, unblind } from "../crypto/blind";
import { keyImage, schnorrVerify } from "../crypto/ristretto";
import { boxOpen, type GroupKeys, groupKeys, open as openSealed, seal } from "../crypto/seal";
import { fromB64u, fromUtf8, randomBytes, toB64u, toHex, utf8 } from "../lib/bytes";
import type { SignalConfig, TransportFactory } from "../signal/mux";
import { LOG_KIND, NostrTransport } from "../signal/nostr";
import type { TransportStatus, WebSocketCtor } from "../signal/types";
import {
  createAction,
  createAdmit,
  createGenesis,
  createKeyEvent,
  createPassBatch,
  createPledge,
  createPoll,
  createRequest,
  createVote,
  createVouchEvent,
  type Me,
  meFromSeed,
  normalizePassword,
  passKey,
  passProof,
  ticketRequest,
} from "./author";
import type { Invitation } from "./codes";
import {
  type AgoraEvent,
  asCard,
  CONTROL,
  DOMAIN,
  eventId,
  type Genesis,
  type MemberCard,
  parseEvent,
  passTag,
  type RequestEvent,
  requestContext,
  signedMessage,
  type Vouch,
} from "./events";
import { currentRing, fold, type GroupView } from "./group";
import type { Store } from "./store";
import { Swarm, wireId } from "./swarm";
import { type RingCheck, Verifier } from "./verify";

/** What the profile keeps about a group. */
export interface GroupRecord {
  /** Hex group id. */
  id: string;
  secret: string;
  genesisId: string;
  /** Cached for the home screen. */
  name: string;
  seed: string;
  memberName?: string;
  /** Organizer keys held on this device (BLS secrets), with how many tickets each signed. */
  organizer?: { secret: string; served: number }[];
  /** Entry passwords made on this device (organizer), to show again. */
  passwords?: { batch: string; codes: string[]; at: number }[];
  /** A blind ticket request waiting for the organizer's answer. */
  ticket?: { issuer: string; factor: string; request: string };
  /** Pseudonyms of the members we asked to vouch for us. */
  asked?: string[];
  /** Keys of newcomers whose request we set aside. */
  dismissed?: string[];
  /** Our admission, ready, published at `at` (a delay unlinks it from the ticket's signing). */
  pendingAdmit?: { at: number; event: string };
  joinedAt: number;
  /** When this device last had the relays' history (seconds), to ask only for what is newer. */
  syncedAt?: number;
}

/** A newcomer who asked us, by name, to vouch for them (checked: they hold the card's key). */
export interface IncomingRequest {
  card: MemberCard;
  ts: number;
}

export interface NetOptions {
  signal: SignalConfig;
  iceServers: RTCIceServer[];
  /** Force TURN for peer-to-peer links. */
  relayOnly?: boolean;
  /** Tests: no network at all. */
  offline?: boolean;
  factory?: TransportFactory;
  WebSocket?: WebSocketCtor;
  rtc?: typeof RTCPeerConnection;
  ringCheck?: RingCheck;
  /** Random delay before maintenance (rekeys, grants), so members do not all do it at once. */
  maintenanceDelay?: () => number;
}

export interface SessionHooks {
  /** The record changed (and must be saved). */
  onRecord(rec: GroupRecord): void;
}

const MIN_DELAY = 1000;

export class GroupSession {
  readonly g: GroupKeys;
  readonly me: Me;
  readonly view = signal<GroupView>();
  readonly peers = signal(0);
  readonly relays = signal<TransportStatus | null>(null);
  readonly verifying = signal<{ done: number; total: number } | null>(null);
  /** Vouches published for our card (while we are not a member yet). */
  readonly vouches = signal<Vouch[]>([]);
  /** Newcomers asking us to vouch for them (only while we are a member). */
  readonly requests = signal<IncomingRequest[]>([]);
  /** Reading this group from the device's storage failed (it still syncs from the network). */
  readonly storageFailed = signal(false);
  /** Bumped whenever the record changes (pending ticket, scheduled admission…). */
  readonly recordRev = signal(0);

  private readonly wires = new Map<string, string>();
  private readonly events = new Map<string, AgoraEvent>();
  private readonly sealed = new Set<string>();
  private readonly verifier: Verifier;
  private readonly images = new Map<string, string>();
  /** Requests addressed to us, opened once: the card inside, or null if it does not check. */
  private readonly opened = new Map<string, MemberCard | null>();
  private nostr: NostrTransport | null = null;
  private swarm: Swarm | null = null;
  private recomputing = false;
  private again = false;
  private maintenance: ReturnType<typeof setTimeout> | undefined;
  private admitTimer: ReturnType<typeof setTimeout> | undefined;
  private syncTimer: ReturnType<typeof setTimeout> | undefined;
  private deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  private closed = false;
  private admitting = false;

  constructor(
    public record: GroupRecord,
    private readonly store: Store,
    private readonly net: NetOptions,
    private readonly hooks: SessionHooks,
    verdicts: [string, boolean][] = [],
  ) {
    this.g = groupKeys(fromB64u(record.secret));
    this.me = meFromSeed(fromB64u(record.seed), record.memberName);
    this.verifier = new Verifier(this.g.groupId, net.ringCheck, verdicts, (id, ok) => {
      void this.store.setVerdict(record.id, id, ok);
    });
    this.view.value = fold(this.g, record.genesisId, this.events, new Set(), this.me);
  }

  /** Loads what the store holds, goes online, then checks and folds. */
  async start(): Promise<void> {
    // Storage that fails or hangs must not keep the group offline: go on without it.
    try {
      this.verifier.preload(await this.store.verdicts(this.record.id));
      for (const wire of await this.store.wires(this.record.id)) await this.ingest(wire, false);
    } catch {
      this.storageFailed.value = true;
    }
    if (!this.net.offline && !this.closed) this.connect();
    await this.recompute();
    this.scheduleAdmit();
  }

  private connect(): void {
    const topic = this.g.topic;
    const cfg = this.net.signal;
    if (cfg.nostr.enabled && cfg.nostr.relays.length > 0) {
      const since = this.record.syncedAt ? Math.max(0, this.record.syncedAt - 2 * 86_400) : 0;
      this.nostr = new NostrTransport(
        cfg.nostr.relays,
        {
          onEnvelope: (wire) => void this.ingest(wire, true),
          onStatus: (s) => {
            this.relays.value = s;
            if (s.state === "online" && !this.syncTimer) {
              // Online for a minute: whatever is older is held.
              this.syncTimer = setTimeout(() => {
                this.updateRecord({ syncedAt: Math.floor(Date.now() / 1000) - 120 });
              }, 60_000);
            }
          },
        },
        {
          kind: LOG_KIND,
          freshKeys: true,
          since: () => since,
          ...(this.net.WebSocket ? { WebSocket: this.net.WebSocket } : {}),
        },
      );
      this.nostr.join(topic);
    }
    this.swarm = new Swarm(
      this.g,
      {
        have: () => [...this.wires.keys()],
        wire: (id) => this.wires.get(id),
        receive: (wire) => void this.ingest(wire, true),
        onPeers: (n) => {
          this.peers.value = n;
        },
      },
      {
        config: cfg,
        iceServers: this.net.iceServers,
        ...(this.net.relayOnly ? { relayOnly: true } : {}),
        ...(this.net.factory ? { factory: this.net.factory } : {}),
        ...(this.net.rtc ? { rtc: this.net.rtc } : {}),
      },
    );
  }

  close(): void {
    this.closed = true;
    clearTimeout(this.maintenance);
    clearTimeout(this.admitTimer);
    clearTimeout(this.syncTimer);
    clearTimeout(this.deadlineTimer);
    this.nostr?.close();
    this.swarm?.close();
  }

  private updateRecord(patch: { [K in keyof GroupRecord]?: GroupRecord[K] | undefined }): void {
    const next = { ...this.record, ...patch } as Record<string, unknown>;
    for (const [k, v] of Object.entries(patch)) if (v === undefined) delete next[k];
    this.record = next as unknown as GroupRecord;
    this.recordRev.value++;
    this.hooks.onRecord(this.record);
  }

  // -------------------------------------------------------------------------
  // Events in

  /** Takes a sealed event from anywhere; true if it was new. */
  async ingest(wire: string, fromNetwork: boolean): Promise<boolean> {
    if (wire.length > 200_000 || !/^[A-Za-z0-9_-]+$/.test(wire)) return false;
    const id = await wireId(wire);
    if (this.wires.has(id)) return false;
    this.wires.set(id, wire);
    if (fromNetwork) {
      // Never waited on: a slow or hung storage must not hold events back.
      this.persist(id, wire);
      // Peers that are online get it at once, even if it is not readable here.
      this.swarm?.broadcast(wire);
    }
    if (this.tryOpen(wire)) this.schedule();
    return true;
  }

  private tryOpen(wire: string): boolean {
    let plain: string;
    try {
      plain = fromUtf8(
        openSealed(this.view.value?.keys ?? new Map(), this.g.groupId, fromB64u(wire)),
      );
    } catch {
      return false; // not readable (yet): kept, retried when a new key arrives
    }
    this.sealed.add(wire);
    let raw: unknown;
    try {
      raw = JSON.parse(plain);
    } catch {
      return false;
    }
    const ev = parseEvent(raw);
    if (!ev) return false;
    const id = eventId(ev);
    if (this.events.has(id)) return false;
    this.events.set(id, ev);
    return true;
  }

  private schedule(): void {
    if (this.recomputing) {
      this.again = true;
      return;
    }
    queueMicrotask(() => void this.recompute());
  }

  private async recompute(): Promise<void> {
    if (this.recomputing) {
      this.again = true;
      return;
    }
    this.recomputing = true;
    try {
      do {
        this.again = false;
        const keysBefore = this.view.value?.keys.size ?? 0;
        const valid = await this.verifier.run(this.events, {
          onProgress: (done, total) => {
            this.verifying.value = done < total ? { done, total } : null;
          },
          onBatch: (v) => this.show(v),
        });
        this.verifying.value = null;
        const view = this.show(valid);
        // New keys: what was unreadable may open now.
        if (view.keys.size > keysBefore) {
          for (const wire of this.wires.values())
            if (!this.sealed.has(wire) && this.tryOpen(wire)) this.again = true;
        }
        this.collectVouches(valid);
        this.collectRequests();
      } while (this.again && !this.closed);
    } finally {
      this.recomputing = false;
    }
    this.planMaintenance();
  }

  /** Folds what is known valid now and shows it. */
  private show(valid: ReadonlySet<string>): GroupView {
    const view = fold(
      this.g,
      this.record.genesisId,
      this.events,
      valid,
      this.me,
      Date.now(),
      this.images,
    );
    this.view.value = view;
    if (view.genesis && view.genesis.name !== this.record.name)
      this.updateRecord({ name: view.genesis.name });
    this.planDeadline(view);
    return view;
  }

  /** Folds again when the next poll or action closes (results, motions take effect then). */
  private planDeadline(view: GroupView): void {
    clearTimeout(this.deadlineTimer);
    const now = Date.now();
    let next = Number.POSITIVE_INFINITY;
    for (const p of view.polls) if (p.poll.closes > now) next = Math.min(next, p.poll.closes);
    for (const a of view.actions) if (a.action.closes > now) next = Math.min(next, a.action.closes);
    if (!Number.isFinite(next) || this.closed) return;
    // setTimeout holds at most ~24.8 days; a later deadline is planned again on the way.
    this.deadlineTimer = setTimeout(
      () => {
        if (this.recomputing) return;
        this.show(this.verifier.valid(this.events));
        this.planMaintenance();
      },
      Math.min(next - now + 50, 2 ** 31 - 1),
    );
  }

  private collectVouches(valid: ReadonlySet<string>): void {
    const view = this.view.value;
    if (!view || view.me) {
      if (this.vouches.value.length) this.vouches.value = [];
      return;
    }
    const mine = new Map<string, Vouch>();
    const members = new Set(view.members.map((m) => m.key));
    for (const [id, ev] of this.events) {
      if (ev.t !== "vouch" || !valid.has(id) || ev.for.key !== this.me.card.key) continue;
      if (ev.for.box !== this.me.card.box || (ev.for.name ?? "") !== (this.me.card.name ?? ""))
        continue;
      if (members.has(ev.by)) mine.set(ev.by, { by: ev.by, sig: ev.sig });
    }
    const list = [...mine.values()];
    if (list.length !== this.vouches.value.length) this.vouches.value = list;
    // Enough vouches: join by ourselves.
    const need = this.vouchesNeeded();
    if (need > 0 && list.length >= need && !this.record.pendingAdmit && !this.admitted())
      void this.admitWithVouches();
  }

  private openRequest(id: string, ev: RequestEvent): MemberCard | null {
    if (this.opened.has(id)) return this.opened.get(id) ?? null;
    let card: MemberCard | null = null;
    const plain = boxOpen(this.me.box.secret, fromB64u(ev.box), requestContext(this.g.groupId));
    if (plain) {
      try {
        card = asCard((JSON.parse(fromUtf8(plain)) as { card?: unknown }).card);
      } catch {
        card = null;
      }
      const msg = signedMessage(this.g.groupId, ev);
      if (card && !schnorrVerify(DOMAIN.pop, fromB64u(card.key), msg, fromB64u(ev.sig)))
        card = null;
    }
    this.opened.set(id, card);
    return card;
  }

  private collectRequests(): void {
    const view = this.view.value;
    if (!view?.me) {
      if (this.requests.value.length) this.requests.value = [];
      return;
    }
    const known = new Set([...view.members, ...view.excluded].map((m) => m.key));
    const dismissed = new Set(this.record.dismissed ?? []);
    const vouched = new Set<string>();
    for (const ev of this.events.values())
      if (ev.t === "vouch" && ev.by === this.me.card.key) vouched.add(ev.for.key);
    const out = new Map<string, IncomingRequest>();
    for (const [id, ev] of this.events) {
      if (ev.t !== "request" || ev.to !== this.me.card.box) continue;
      const card = this.openRequest(id, ev);
      if (!card || known.has(card.key) || vouched.has(card.key) || dismissed.has(card.key))
        continue;
      const prev = out.get(card.key);
      if (!prev || ev.ts > prev.ts) out.set(card.key, { card, ts: ev.ts });
    }
    const list = [...out.values()].sort((a, b) => a.ts - b.ts);
    const same =
      list.length === this.requests.value.length &&
      list.every((r, i) => r.card.key === this.requests.value[i]?.card.key);
    if (!same) this.requests.value = list;
  }

  /**
   * Asks the member(s) going by `name` (typed by the newcomer: no list of members is shown)
   * to vouch for us. The newcomer is never told whether that name exists: the request reads
   * as sent either way, so the form cannot be used to find out who is in the group. Returns
   * how many members got it (for tests).
   */
  async requestVouch(name: string): Promise<number> {
    const view = this.view.value;
    const wanted = name.trim().toLocaleLowerCase();
    if (!view || !wanted) return 0;
    const targets = view.members.filter(
      (m) => m.key !== this.me.card.key && m.name?.trim().toLocaleLowerCase() === wanted,
    );
    for (const t of targets) await this.publish(createRequest(this.g, this.me, t));
    // As typed, matched or not.
    const typed = name.trim();
    const asked = (this.record.asked ?? []).filter(
      (n) => n.toLocaleLowerCase() !== typed.toLocaleLowerCase(),
    );
    this.updateRecord({ asked: [...asked, typed] });
    return targets.length;
  }

  /** Sets a newcomer's request aside (on this device). */
  dismissRequest(key: string): void {
    this.updateRecord({ dismissed: [...new Set([...(this.record.dismissed ?? []), key])] });
    this.collectRequests();
  }

  /** Vouches a newcomer needs right now (0 when vouching is off). */
  vouchesNeeded(): number {
    const v = this.view.value;
    if (!v?.policy || v.policy.vouches === 0) return 0;
    return Math.min(v.policy.vouches, v.members.length);
  }

  private admitted(): boolean {
    for (const ev of this.events.values())
      if (ev.t === "admit" && ev.member.key === this.me.card.key) return true;
    return false;
  }

  // -------------------------------------------------------------------------
  // Events out

  async publish(ev: AgoraEvent): Promise<string> {
    const view = this.view.value;
    const key = CONTROL.has(ev.t) || !view ? this.g.linkKey : view.writeKey;
    const wire = toB64u(seal(key, this.g.groupId, utf8(JSON.stringify(ev))));
    const id = await wireId(wire);
    const evId = eventId(ev);
    // Ours: no need to spend a ring check on it, and it shows at once.
    this.verifier.trust(evId);
    await this.ingest(wire, false);
    // Out first, then kept: neither the network nor the storage waits on the other.
    this.nostr?.send(this.g.topic, wire);
    this.swarm?.broadcast(wire);
    this.persist(id, wire);
    // Shown now; other people's events still being checked are folded in as they pass.
    this.show(this.verifier.valid(this.events));
    this.schedule();
    return evId;
  }

  private persist(id: string, wire: string): void {
    this.store.addWire(this.record.id, id, wire).catch(() => {
      this.storageFailed.value = true;
    });
  }

  private requireMember() {
    const view = this.view.value;
    if (!view?.me) throw new Error("not a member yet");
    return view;
  }

  async vouch(card: MemberCard): Promise<string> {
    this.requireMember();
    const id = await this.publish(createVouchEvent(this.g, this.me, card));
    this.collectRequests();
    return id;
  }

  private async admitWithVouches(): Promise<void> {
    if (this.admitting) return;
    this.admitting = true;
    try {
      await this.publish(createAdmit(this.g, this.me, { vouches: this.vouches.value }));
    } finally {
      this.admitting = false;
    }
  }

  /** Starts a blind ticket request for `issuer` (base64url BLS public key); returns the request. */
  requestTicket(issuer: string): Uint8Array {
    const req = ticketRequest(this.g, this.me);
    this.updateRecord({
      ticket: { issuer, factor: req.factor.toString(16), request: toB64u(req.request) },
    });
    return req.request;
  }

  /**
   * Unblinds the organizer's answer and schedules our admission: after `delayMs` (random by
   * default, so the organizer cannot match the admission to the moment they signed).
   */
  /**
   * Uses an entry password: finds the organizer's batch it belongs to and schedules our
   * admission (after `delayMs`, like a ticket). Throws "unknown" (not a password of this group,
   * or its batch has not arrived yet) or "used".
   */
  async usePassword(text: string, delayMs: number): Promise<void> {
    const password = normalizePassword(text);
    if (!password) throw new Error("unknown");
    const key = toB64u(passKey(this.g, password).pub);
    const found = this.view.value?.passBatches.find((b) => b.batch.keys.includes(key));
    if (!found) throw new Error("unknown");
    const secret = passKey(this.g, password).secret;
    const image = toHex(keyImage(secret, passTag(this.g.groupId, found.id)));
    if (found.spent.has(image)) throw new Error("used");
    const pass = passProof(this.g, this.me, found.batch, found.id, password);
    const at = Date.now() + delayMs;
    const ev = createAdmit(this.g, this.me, { vouches: [], pass }, at);
    this.updateRecord({ pendingAdmit: { at, event: JSON.stringify(ev) } });
    this.scheduleAdmit();
  }

  /** Organizer side: makes `count` one-time entry passwords and publishes their batch. */
  async createPasswords(count: number): Promise<string[]> {
    const org = this.organizer();
    if (!org) throw new Error("not an organizer");
    const { event, passwords } = createPassBatch(this.g, org, count);
    const batch = await this.publish(event);
    this.updateRecord({
      passwords: [...(this.record.passwords ?? []), { batch, codes: passwords, at: event.ts }],
    });
    return passwords;
  }

  async acceptTicket(answer: Uint8Array, delayMs: number): Promise<void> {
    const t = this.record.ticket;
    if (!t) throw new Error("no ticket request");
    const sig = unblind(
      answer,
      BigInt(`0x${t.factor}`),
      this.g.groupId,
      this.me.sign.pub,
      fromB64u(t.issuer),
    );
    const ev = createAdmit(
      this.g,
      this.me,
      { vouches: [], ticket: { issuer: t.issuer, sig: toB64u(sig) } },
      Date.now() + delayMs,
    );
    this.updateRecord({
      ticket: undefined,
      pendingAdmit: { at: Date.now() + delayMs, event: JSON.stringify(ev) },
    });
    this.scheduleAdmit();
  }

  private scheduleAdmit(): void {
    clearTimeout(this.admitTimer);
    const p = this.record.pendingAdmit;
    if (!p) return;
    this.admitTimer = setTimeout(
      async () => {
        const ev = parseEvent(JSON.parse(p.event));
        if (ev) await this.publish(ev);
        this.updateRecord({ pendingAdmit: undefined });
      },
      Math.max(0, p.at - Date.now()),
    );
  }

  /** Publishes a delayed admission now (the newcomer chose not to wait). */
  async admitNow(): Promise<void> {
    const p = this.record.pendingAdmit;
    if (!p) return;
    clearTimeout(this.admitTimer);
    const held = parseEvent(JSON.parse(p.event));
    if (held?.t !== "admit") return;
    // Signed again with the real time (the held one is dated when the delay ends).
    const ev = createAdmit(this.g, this.me, {
      vouches: held.vouches,
      ...(held.ticket ? { ticket: held.ticket } : {}),
      ...(held.pass ? { pass: held.pass } : {}),
    });
    await this.publish(ev);
    this.updateRecord({ pendingAdmit: undefined });
  }

  /** Organizer side: signs a blinded request with this device's organizer key. */
  signTicket(request: Uint8Array): Uint8Array {
    const org = this.record.organizer?.[0];
    if (!org) throw new Error("not an organizer");
    const answer = signBlinded(fromB64u(org.secret), request);
    this.updateRecord({
      organizer: [{ ...org, served: org.served + 1 }, ...(this.record.organizer ?? []).slice(1)],
    });
    return answer;
  }

  organizer(): Issuer | null {
    const org = this.record.organizer?.[0];
    return org ? issuerFromSecret(fromB64u(org.secret)) : null;
  }

  addOrganizerKey(secret: Uint8Array): void {
    const pub = toB64u(issuerFromSecret(secret).pub);
    if (!this.view.value?.policy?.issuers.includes(pub))
      throw new Error("not an organizer key of this group");
    this.updateRecord({ organizer: [{ secret: toB64u(secret), served: 0 }] });
  }

  createPoll(opts: {
    q: string;
    options: string[];
    multi: boolean;
    closes: number;
    exclude?: string;
  }): Promise<string> {
    const view = this.requireMember();
    return this.publish(createPoll(this.g, this.me, currentRing(view), opts));
  }

  vote(pollId: string, choice: number[]): Promise<string> {
    const view = this.requireMember();
    const pv = view.polls.find((p) => p.id === pollId);
    if (!pv) throw new Error("unknown poll");
    const seq = pv.mine ? pv.mine.seq + 1 : 0;
    return this.publish(createVote(this.g, this.me, pv.poll, pollId, choice, seq));
  }

  createAction(opts: { title: string; details: string; threshold: number; closes: number }) {
    const view = this.requireMember();
    return this.publish(createAction(this.g, this.me, currentRing(view), opts));
  }

  pledge(actionId: string, on: boolean): Promise<string> {
    const view = this.requireMember();
    const av = view.actions.find((a) => a.id === actionId);
    if (!av) throw new Error("unknown action");
    const seq = av.mine ? av.mine.seq + 1 : 0;
    return this.publish(createPledge(this.g, this.me, av.action, actionId, on, seq));
  }

  // -------------------------------------------------------------------------
  // Maintenance: after an exclusion, a new key; for newcomers, the current key.

  private planMaintenance(): void {
    const view = this.view.value;
    if (!view?.me || this.closed || this.net.offline) return;
    if (!view.needsRekey && view.needsGrant.length === 0) return;
    if (this.maintenance) return;
    const delay = this.net.maintenanceDelay?.() ?? MIN_DELAY + Math.random() * 20_000;
    this.maintenance = setTimeout(() => {
      this.maintenance = undefined;
      void this.maintain();
    }, delay);
  }

  /** Runs pending maintenance now (exposed for tests). */
  async maintain(): Promise<void> {
    const view = this.view.value;
    if (!view?.me || this.closed) return;
    if (view.needsRekey) {
      await this.publish(createKeyEvent(this.g, this.me, randomBytes(32), view.members));
    } else if (view.needsGrant.length > 0 && view.currentKey) {
      await this.publish(createKeyEvent(this.g, this.me, view.currentKey, view.needsGrant));
    }
  }
}

// ---------------------------------------------------------------------------
// New groups

/** A new group: its record (founder's keys, organizer key if asked) and its genesis event. */
export function foundGroup(opts: {
  name: string;
  about: string;
  /** Vouches a newcomer needs (0: no vouching). */
  vouches: number;
  /** Generate an organizer key on this device for blind tickets. */
  organizer: boolean;
  memberName?: string;
}): { record: GroupRecord; genesis: Genesis } {
  const secret = randomBytes(32);
  const g = groupKeys(secret);
  const seed = randomBytes(32);
  const me = meFromSeed(seed, opts.memberName);
  const issuer = opts.organizer ? newIssuer() : null;
  const genesis = createGenesis(g, me, {
    name: opts.name,
    about: opts.about,
    policy: { vouches: opts.vouches, issuers: issuer ? [toB64u(issuer.pub)] : [] },
  });
  const record: GroupRecord = {
    id: toHex(g.groupId),
    secret: toB64u(secret),
    genesisId: eventId(genesis),
    name: opts.name,
    seed: toB64u(seed),
    joinedAt: Date.now(),
  };
  if (opts.memberName) record.memberName = opts.memberName;
  if (issuer) record.organizer = [{ secret: toB64u(issuer.secret), served: 0 }];
  return { record, genesis };
}

/** A record for a group joined from an invitation (its events come from the network). */
export function joinRecord(inv: Invitation, memberName?: string): GroupRecord {
  const record: GroupRecord = {
    id: toHex(groupKeys(inv.secret).groupId),
    secret: toB64u(inv.secret),
    genesisId: inv.genesisId,
    name: "",
    seed: toB64u(randomBytes(32)),
    joinedAt: Date.now(),
  };
  if (memberName) record.memberName = memberName;
  return record;
}
