/**
 * Folds a group's verified events into what the app shows: who is a member,
 * each poll's tally, each action's pledges, which keys this device holds.
 * Pure and deterministic: two devices holding the same events agree.
 *
 * The roster is replayed in time order. An admission counts if its vouchers
 * were members at that moment (k of them, or every member while the group is
 * smaller than k) or if it carries a ticket from one of the group's
 * organizers. A poll or action counts if its whole ring was made of members
 * when it was created. A motion to exclude takes effect when it closes with
 * "yes" from more than half of its ring.
 */
import { keyImage } from "../crypto/ristretto";
import { boxOpen, type GroupKeys, keyId } from "../crypto/seal";
import { type Bytes, fromB64u, toHex } from "../lib/bytes";
import type { Me } from "./author";
import {
  type Action,
  type Admit,
  type AgoraEvent,
  boxContext,
  type Genesis,
  type KeyEvent,
  type MemberCard,
  type Pledge,
  type Policy,
  type Poll,
  pledgeTag,
  SKEW_MS,
  type Vote,
  voteTag,
} from "./events";

export interface MemberView extends MemberCard {
  via: "founder" | "vouch" | "ticket";
  vouchedBy: string[];
  issuer?: string;
  admittedAt: number;
  excludedAt?: number;
}

export interface PollView {
  id: string;
  poll: Poll;
  counts: number[];
  voters: number;
  closed: boolean;
  /** Members of the group when the poll was made, for "ring: 9 of 10 members". */
  rosterSize: number;
  mine?: { choice: number[]; seq: number };
  /** For a motion to exclude: whether it passed (once closed). */
  passed?: boolean;
}

export interface ActionView {
  id: string;
  action: Action;
  pledged: number;
  reached: boolean;
  closed: boolean;
  rosterSize: number;
  mine?: { on: boolean; seq: number };
}

export interface GroupView {
  genesisId: string;
  genesis?: Genesis;
  policy?: Policy;
  members: MemberView[];
  excluded: MemberView[];
  polls: PollView[];
  actions: ActionView[];
  /** Every key this device can read with, by key id (the link key included). */
  keys: Map<string, Bytes>;
  /** The key new content is sealed with. */
  writeKey: Bytes;
  me?: MemberView;
  /** An exclusion took effect and no new key followed it. */
  needsRekey: boolean;
  /** Members missing the current key (admitted after the last rekey). */
  needsGrant: MemberCard[];
  /** The current key, when it is not the link key. */
  currentKey?: Bytes;
}

interface Item {
  at: number;
  id: string;
  ev: Admit | Poll | Action | KeyEvent;
}

const imageOf = (sig: string) => toHex(fromB64u(sig).subarray(0, 32));

/** Latest entry per key image: highest seq, then lowest id. */
function latestByImage<T extends Vote | Pledge>(entries: [string, T][]): Map<string, T> {
  const best = new Map<string, [string, T]>();
  for (const [id, ev] of entries) {
    const img = imageOf(ev.sig);
    const cur = best.get(img);
    if (!cur || ev.seq > cur[1].seq || (ev.seq === cur[1].seq && id < cur[0]))
      best.set(img, [id, ev]);
  }
  return new Map([...best].map(([img, [, ev]]) => [img, ev]));
}

export function fold(
  g: GroupKeys,
  genesisId: string,
  events: ReadonlyMap<string, AgoraEvent>,
  valid: ReadonlySet<string>,
  me: Me | undefined,
  now = Date.now(),
  /** Our key images by tag, kept across folds (each costs a hash to the curve and a product). */
  images: Map<string, string> = new Map(),
): GroupView {
  const myImage = (kind: string, id: string, tag: Uint8Array): string => {
    const k = `${kind}:${id}`;
    let img = images.get(k);
    if (img === undefined && me) {
      img = toHex(keyImage(me.sign.secret, tag));
      images.set(k, img);
    }
    return img ?? "";
  };
  const linkKid = keyId(g.linkKey);
  const view: GroupView = {
    genesisId,
    members: [],
    excluded: [],
    polls: [],
    actions: [],
    keys: new Map([[linkKid, g.linkKey]]),
    writeKey: g.linkKey,
    needsRekey: false,
    needsGrant: [],
  };
  const genesis = events.get(genesisId);
  if (genesis?.t !== "genesis" || !valid.has(genesisId)) return view;
  view.genesis = genesis;
  view.policy = genesis.policy;
  const policy = genesis.policy;

  // Votes and pledges by target.
  const votes = new Map<string, [string, Vote][]>();
  const pledges = new Map<string, [string, Pledge][]>();
  const items: Item[] = [];
  for (const [id, ev] of events) {
    if (!valid.has(id)) continue;
    if (ev.t === "vote") {
      const list = votes.get(ev.poll) ?? [];
      list.push([id, ev]);
      votes.set(ev.poll, list);
    } else if (ev.t === "pledge") {
      const list = pledges.get(ev.action) ?? [];
      list.push([id, ev]);
      pledges.set(ev.action, list);
    } else if (ev.t === "admit") items.push({ at: ev.ts, id, ev });
    else if (ev.t === "poll" || ev.t === "action" || ev.t === "key")
      items.push({ at: ev.ts + SKEW_MS, id, ev });
  }
  items.sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const roster = new Map<string, MemberView>();
  const burned = new Set<string>();
  roster.set(genesis.founder.key, {
    ...genesis.founder,
    via: "founder",
    vouchedBy: [],
    admittedAt: genesis.ts,
  });
  const isMember = (key: string, at: number) => {
    const m = roster.get(key);
    return !!m && (m.excludedAt === undefined || m.excludedAt > at);
  };
  const current = () => [...roster.values()].filter((m) => m.excludedAt === undefined);

  const tallyPoll = (id: string, poll: Poll) => {
    const inTime = (votes.get(id) ?? []).filter(([, v]) => v.ts <= poll.closes);
    const latest = latestByImage(inTime);
    const counts = new Array<number>(poll.options.length).fill(0);
    for (const v of latest.values()) {
      for (const c of v.choice) if (c < counts.length) counts[c] = (counts[c] ?? 0) + 1;
    }
    return { counts, voters: latest.size, latest };
  };

  // Motions to exclude, applied once their closing time is passed in the replay.
  const motions: { at: number; id: string; poll: Poll }[] = [];
  let lastExclusion = -1;
  const applyMotions = (upTo: number) => {
    motions.sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1));
    while (motions.length && (motions[0] as (typeof motions)[number]).at <= upTo) {
      const m = motions.shift() as (typeof motions)[number];
      const { counts } = tallyPoll(m.id, m.poll);
      const target = m.poll.exclude as string;
      const member = roster.get(target);
      if ((counts[0] ?? 0) * 2 > m.poll.ring.length && member && member.excludedAt === undefined) {
        member.excludedAt = m.at;
        burned.add(target);
        lastExclusion = Math.max(lastExclusion, m.at);
      }
    }
  };

  const validPolls: { id: string; poll: Poll; rosterSize: number }[] = [];
  const validActions: { id: string; action: Action; rosterSize: number }[] = [];
  const keyEvents: { id: string; ev: KeyEvent }[] = [];

  for (const it of items) {
    applyMotions(Math.min(it.at, now));
    const ev = it.ev;
    if (ev.t === "admit") {
      const key = ev.member.key;
      if (roster.has(key) || burned.has(key)) continue;
      const members = current();
      const vouchers = [...new Set(ev.vouches.map((v) => v.by))].filter(
        (k) => k !== key && isMember(k, ev.ts),
      );
      const need = Math.min(policy.vouches, members.length);
      const byVouch = policy.vouches > 0 && need > 0 && vouchers.length >= need;
      const byTicket = !!ev.ticket && policy.issuers.includes(ev.ticket.issuer);
      if (!byVouch && !byTicket) continue;
      const m: MemberView = {
        ...ev.member,
        via: byVouch ? "vouch" : "ticket",
        vouchedBy: byVouch ? vouchers : [],
        admittedAt: ev.ts,
      };
      if (!byVouch && ev.ticket) m.issuer = ev.ticket.issuer;
      roster.set(key, m);
    } else if (ev.t === "poll" || ev.t === "action") {
      if (!ev.ring.every((k) => isMember(k, ev.ts))) continue;
      const rosterSize = current().length;
      if (ev.t === "poll") {
        validPolls.push({ id: it.id, poll: ev, rosterSize });
        if (ev.exclude) motions.push({ at: ev.closes, id: it.id, poll: ev });
      } else validActions.push({ id: it.id, action: ev, rosterSize });
    } else if (ev.t === "key") {
      if (isMember(ev.by, ev.ts)) keyEvents.push({ id: it.id, ev });
    }
  }
  applyMotions(now);

  for (const m of roster.values())
    (m.excludedAt === undefined ? view.members : view.excluded).push(m);
  const byTime = (a: MemberView, b: MemberView) => a.admittedAt - b.admittedAt;
  view.members.sort(byTime);
  view.excluded.sort(byTime);
  const myKey = me?.card.key;
  const meView = myKey ? roster.get(myKey) : undefined;
  if (meView && meView.excludedAt === undefined) view.me = meView;

  // Polls and actions.
  for (const { id, poll, rosterSize } of validPolls) {
    const { counts, voters, latest } = tallyPoll(id, poll);
    const pv: PollView = { id, poll, counts, voters, closed: now >= poll.closes, rosterSize };
    if (me && poll.ring.includes(me.card.key)) {
      const mine = latest.get(myImage("vote", id, voteTag(g.groupId, id)));
      if (mine) pv.mine = { choice: mine.choice, seq: mine.seq };
    }
    if (poll.exclude && pv.closed) pv.passed = (counts[0] ?? 0) * 2 > poll.ring.length;
    view.polls.push(pv);
  }
  view.polls.sort((a, b) => b.poll.ts - a.poll.ts);
  for (const { id, action, rosterSize } of validActions) {
    const inTime = (pledges.get(id) ?? []).filter(([, p]) => p.ts <= action.closes);
    const latest = latestByImage(inTime);
    let pledged = 0;
    for (const p of latest.values()) if (p.on) pledged++;
    const av: ActionView = {
      id,
      action,
      pledged,
      reached: pledged >= action.threshold,
      closed: now >= action.closes,
      rosterSize,
    };
    if (me && action.ring.includes(me.card.key)) {
      const mine = latest.get(myImage("pledge", id, pledgeTag(g.groupId, id)));
      if (mine) av.mine = { on: mine.on, seq: mine.seq };
    }
    view.actions.push(av);
  }
  view.actions.sort((a, b) => b.action.ts - a.action.ts);

  // Keys: open what was boxed to us; the newest key we hold is the one we write with.
  keyEvents.sort((a, b) => a.ev.ts - b.ev.ts || (a.id < b.id ? -1 : 1));
  if (me) {
    const myBox = me.card.box;
    let newest = -1;
    for (const { ev } of keyEvents) {
      const box = ev.boxes.find((b) => b.to === myBox);
      if (!box) continue;
      let key = view.keys.get(ev.kid);
      if (!key) {
        const opened = boxOpen(me.box.secret, fromB64u(box.box), boxContext(g.groupId, ev.kid));
        if (!opened || keyId(opened) !== ev.kid) continue;
        key = opened;
        view.keys.set(ev.kid, key);
      }
      if (ev.ts >= newest) {
        newest = ev.ts;
        view.writeKey = key;
      }
    }
  }
  // The group's current key: the newest key event made after the last exclusion.
  const after = keyEvents.filter((k) => k.ev.ts > lastExclusion);
  const latest = after[after.length - 1];
  if (lastExclusion >= 0 && !latest) view.needsRekey = true;
  if (latest) {
    const kid = latest.ev.kid;
    const key = view.keys.get(kid);
    if (key) view.currentKey = key;
    const covered = new Set<string>();
    for (const { ev } of after) if (ev.kid === kid) for (const b of ev.boxes) covered.add(b.to);
    view.needsGrant = view.members.filter((m) => !covered.has(m.box));
  }
  return view;
}

/** The ring a new poll or action should use: every current member. */
export function currentRing(view: GroupView): string[] {
  return view.members.map((m) => m.key).sort();
}
