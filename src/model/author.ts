/**
 * Writing events: this device's keys in one group, and the signed events it
 * makes with them. A member has one 32-byte seed per group (never reused
 * across groups, so two groups cannot link their members) from which both
 * the ristretto voting key and the X25519 box key are derived.
 */
import { blindRequest } from "../crypto/blind";
import { type KeyPair, keyPairFromSeed, ringSign, schnorrSign } from "../crypto/ristretto";
import { boxKeyPair, boxSeal, type GroupKeys, keyId } from "../crypto/seal";
import { type Bytes, fromB64u, randomBytes, toB64u } from "../lib/bytes";
import {
  type Action,
  type Admit,
  boxContext,
  createTag,
  DOMAIN,
  type Genesis,
  type KeyEvent,
  type MemberCard,
  type Pledge,
  type Policy,
  type Poll,
  pledgeTag,
  signedMessage,
  type Vote,
  type Vouch,
  type VouchEvent,
  voteTag,
  vouchMessage,
} from "./events";

export interface Me {
  seed: Bytes;
  sign: KeyPair;
  box: { secret: Bytes; pub: Bytes };
  card: MemberCard;
}

export function meFromSeed(seed: Uint8Array, name?: string): Me {
  const sign = keyPairFromSeed(seed);
  const box = boxKeyPair(seed);
  const card: MemberCard = { key: toB64u(sign.pub), box: toB64u(box.pub) };
  if (name) card.name = name;
  return { seed: Uint8Array.from(seed), sign, box, card };
}

export function newMe(name?: string): Me {
  return meFromSeed(randomBytes(32), name);
}

export function createGenesis(
  g: GroupKeys,
  me: Me,
  opts: { name: string; about: string; policy: Policy },
  now = Date.now(),
): Genesis {
  const ev: Genesis = {
    t: "genesis",
    ts: now,
    name: opts.name,
    about: opts.about,
    policy: opts.policy,
    founder: me.card,
    sig: "",
  };
  ev.sig = toB64u(schnorrSign(DOMAIN.pop, me.sign.secret, signedMessage(g.groupId, ev)));
  return ev;
}

/** A member's signature admitting `card` (shown to them as a QR code or a link). */
export function vouchFor(g: GroupKeys, voucher: Me, card: MemberCard): Vouch {
  return {
    by: voucher.card.key,
    sig: toB64u(schnorrSign(DOMAIN.vouch, voucher.sign.secret, vouchMessage(g.groupId, card))),
  };
}

/** The same vouch, published to the group for the newcomer's device to collect. */
export function createVouchEvent(
  g: GroupKeys,
  voucher: Me,
  card: MemberCard,
  now = Date.now(),
): VouchEvent {
  const v = vouchFor(g, voucher, card);
  return { t: "vouch", ts: now, for: card, by: v.by, sig: v.sig };
}

export function createAdmit(
  g: GroupKeys,
  me: Me,
  proof: { vouches: Vouch[]; ticket?: { issuer: string; sig: string } },
  now = Date.now(),
): Admit {
  const ev: Admit = { t: "admit", ts: now, member: me.card, vouches: proof.vouches, sig: "" };
  if (proof.ticket) ev.ticket = proof.ticket;
  ev.sig = toB64u(schnorrSign(DOMAIN.pop, me.sign.secret, signedMessage(g.groupId, ev)));
  return ev;
}

/** A blinded ticket request for this member key (the organizer signs it without seeing it). */
export function ticketRequest(g: GroupKeys, me: Me) {
  return blindRequest(g.groupId, me.sign.pub);
}

function ringIndex(ring: readonly string[], me: Me): number {
  const i = ring.indexOf(me.card.key);
  if (i < 0) throw new Error("you are not in this ring");
  return i;
}

const ringBytes = (ring: readonly string[]) => ring.map((k) => fromB64u(k));

export function createPoll(
  g: GroupKeys,
  me: Me,
  ring: string[],
  opts: { q: string; options: string[]; multi: boolean; closes: number; exclude?: string },
  now = Date.now(),
): Poll {
  const ev: Poll = {
    t: "poll",
    ts: now,
    q: opts.q,
    options: opts.options,
    multi: opts.multi,
    closes: opts.closes,
    ring: [...ring].sort(),
    nonce: toB64u(randomBytes(16)),
    sig: "",
  };
  if (opts.exclude) ev.exclude = opts.exclude;
  ev.sig = toB64u(
    ringSign(
      signedMessage(g.groupId, ev),
      ringBytes(ev.ring),
      ringIndex(ev.ring, me),
      me.sign.secret,
      createTag(ev.nonce),
    ),
  );
  return ev;
}

export function createVote(
  g: GroupKeys,
  me: Me,
  poll: Poll,
  pollId: string,
  choice: number[],
  seq: number,
  now = Date.now(),
): Vote {
  const ev: Vote = {
    t: "vote",
    ts: now,
    poll: pollId,
    choice: [...choice].sort((a, b) => a - b),
    seq,
    sig: "",
  };
  ev.sig = toB64u(
    ringSign(
      signedMessage(g.groupId, ev),
      ringBytes(poll.ring),
      ringIndex(poll.ring, me),
      me.sign.secret,
      voteTag(g.groupId, pollId),
    ),
  );
  return ev;
}

export function createAction(
  g: GroupKeys,
  me: Me,
  ring: string[],
  opts: { title: string; details: string; threshold: number; closes: number },
  now = Date.now(),
): Action {
  const ev: Action = {
    t: "action",
    ts: now,
    title: opts.title,
    details: opts.details,
    threshold: opts.threshold,
    closes: opts.closes,
    ring: [...ring].sort(),
    nonce: toB64u(randomBytes(16)),
    sig: "",
  };
  ev.sig = toB64u(
    ringSign(
      signedMessage(g.groupId, ev),
      ringBytes(ev.ring),
      ringIndex(ev.ring, me),
      me.sign.secret,
      createTag(ev.nonce),
    ),
  );
  return ev;
}

export function createPledge(
  g: GroupKeys,
  me: Me,
  action: Action,
  actionId: string,
  on: boolean,
  seq: number,
  now = Date.now(),
): Pledge {
  const ev: Pledge = { t: "pledge", ts: now, action: actionId, on, seq, sig: "" };
  ev.sig = toB64u(
    ringSign(
      signedMessage(g.groupId, ev),
      ringBytes(action.ring),
      ringIndex(action.ring, me),
      me.sign.secret,
      pledgeTag(g.groupId, actionId),
    ),
  );
  return ev;
}

/** Boxes `key` to each recipient's X25519 key (a rekey, or a grant to newcomers). */
export function createKeyEvent(
  g: GroupKeys,
  me: Me,
  key: Uint8Array,
  recipients: readonly MemberCard[],
  now = Date.now(),
): KeyEvent {
  const kid = keyId(key);
  const ctx = boxContext(g.groupId, kid);
  const ev: KeyEvent = {
    t: "key",
    ts: now,
    by: me.card.key,
    kid,
    boxes: recipients.map((r) => ({ to: r.box, box: toB64u(boxSeal(fromB64u(r.box), key, ctx)) })),
    sig: "",
  };
  ev.sig = toB64u(schnorrSign(DOMAIN.key, me.sign.secret, signedMessage(g.groupId, ev)));
  return ev;
}
