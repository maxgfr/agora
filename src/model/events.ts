/**
 * The events a group is made of, as they are once opened. Each is a JSON
 * object; binary fields are base64url. See PROTOCOL.md for the full spec.
 *
 *  genesis  the founder creates the group: its name and admission policy
 *  request  a newcomer asks one member (named by them) to vouch, boxed to that member
 *  vouch    a member vouches for a newcomer's card (scanned in person or pasted)
 *  passes   an organizer's batch of one-time entry passwords (their public keys only)
 *  admit    a newcomer's keys, with k vouches, a blind ticket, or an entry password
 *  poll     a question, signed anonymously by a member over a frozen ring
 *  vote     a choice, ring-signed under the poll's tag (one image per member)
 *  action   a collective action: it is on once `threshold` members pledge
 *  pledge   an anonymous "I'm in" (or a withdrawal) under the action's tag
 *  key      a new group key (or a known one) boxed to members' X25519 keys
 *
 * Every signature covers the group id and the canonical JSON of the event
 * without its `sig`, so nothing can be replayed into another group.
 */
import { sha256 } from "@noble/hashes/sha2.js";
import { type Bytes, concat, fromB64u, toB64u, toHex, utf8 } from "../lib/bytes";

export const MAX_MEMBERS = 256;
export const MAX_OPTIONS = 20;
export const MAX_TEXT = 2000;
export const MAX_NAME = 64;
/** How far ahead of a poll's own clock the admissions it relies on may be. */
export const SKEW_MS = 5 * 60_000;

export interface MemberCard {
  /** ristretto255 public key (voting and signing). */
  key: string;
  /** X25519 public key (to receive group keys). */
  box: string;
  /** A pseudonym; omitted by members admitted with a ticket. */
  name?: string;
}

export interface Policy {
  /** Vouches a newcomer needs (capped by the roster size); 0 turns vouching off. */
  vouches: number;
  /** Organizers' BLS public keys whose blind tickets admit a member. */
  issuers: string[];
}

export interface Genesis {
  t: "genesis";
  ts: number;
  name: string;
  about: string;
  policy: Policy;
  founder: MemberCard;
  sig: string;
}

export interface Vouch {
  by: string;
  sig: string;
}

/**
 * A newcomer asks a member to vouch for them. The card is boxed to that member's X25519 key:
 * other holders of the invitation see neither who asks nor whom. `sig` is the newcomer's
 * Schnorr signature (pop domain), checked by the recipient once the box is open.
 */
export interface RequestEvent {
  t: "request";
  ts: number;
  /** The recipient's X25519 public key. */
  to: string;
  /** boxSeal(to, JSON of {card}) under `requestContext`. */
  box: string;
  sig: string;
}

/** A vouch published to the group, so the newcomer's device picks it up by itself. */
export interface VouchEvent {
  t: "vouch";
  ts: number;
  for: MemberCard;
  by: string;
  /** The vouch signature (over `vouchMessage`), the same one an admission carries. */
  sig: string;
}

/**
 * One-time entry passwords, made by an organizer. Each password derives a ristretto key; only
 * the public keys are published, signed by the organizer. A newcomer proves they hold one of
 * them with a linkable ring signature over the batch: the key image spends that password, and
 * the organizer, who knows whom they gave which password, cannot tell which one was used.
 */
export interface PassBatch {
  t: "passes";
  ts: number;
  /** The organizer's BLS public key (one of the policy's issuers). */
  issuer: string;
  /** Sorted, unique public keys of the passwords. */
  keys: string[];
  nonce: string;
  /** The organizer's BLS signature over the event. */
  sig: string;
}

export interface Admit {
  t: "admit";
  ts: number;
  member: MemberCard;
  vouches: Vouch[];
  ticket?: { issuer: string; sig: string };
  /** An entry password: its batch, and a ring signature over the batch's keys. */
  pass?: { batch: string; sig: string };
  sig: string;
}

export interface Poll {
  t: "poll";
  ts: number;
  q: string;
  options: string[];
  multi: boolean;
  closes: number;
  /** Members allowed to vote: sorted, unique ristretto keys. */
  ring: string[];
  nonce: string;
  /** A motion to exclude this member key: option 0 is "yes", passed by a majority of the ring. */
  exclude?: string;
  sig: string;
}

export interface Vote {
  t: "vote";
  ts: number;
  poll: string;
  choice: number[];
  /** A later vote with a higher seq replaces an earlier one (changing one's mind). */
  seq: number;
  sig: string;
}

export interface Action {
  t: "action";
  ts: number;
  title: string;
  details: string;
  threshold: number;
  closes: number;
  ring: string[];
  nonce: string;
  sig: string;
}

export interface Pledge {
  t: "pledge";
  ts: number;
  action: string;
  on: boolean;
  seq: number;
  sig: string;
}

export interface KeyBox {
  to: string;
  box: string;
}

export interface KeyEvent {
  t: "key";
  ts: number;
  by: string;
  kid: string;
  boxes: KeyBox[];
  sig: string;
}

export type AgoraEvent =
  | Genesis
  | RequestEvent
  | PassBatch
  | VouchEvent
  | Admit
  | Poll
  | Vote
  | Action
  | Pledge
  | KeyEvent;
export type EventType = AgoraEvent["t"];

/** Events readable by anyone holding the invitation (so newcomers can join). */
export const CONTROL: ReadonlySet<EventType> = new Set([
  "genesis",
  "request",
  "passes",
  "vouch",
  "admit",
  "key",
]);

// ---------------------------------------------------------------------------
// Canonical form, ids and signed messages

/** JSON with object keys sorted, `undefined` dropped: one event, one byte string. */
export function canonical(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(",")}}`;
}

/** An event's id: 16 bytes of the hash of its canonical form, signature included. */
export function eventId(ev: AgoraEvent): string {
  return toHex(sha256(utf8(canonical(ev))).subarray(0, 16));
}

/** What a signature on `ev` covers. */
export function signedMessage(groupId: Uint8Array, ev: AgoraEvent): Bytes {
  const { sig: _sig, ...body } = ev;
  return sha256(concat(utf8("agora/v1/event"), groupId, utf8(canonical(body)))) as Bytes;
}

/** What a voucher signs: the newcomer's keys and name, in this group. */
export function vouchMessage(groupId: Uint8Array, card: MemberCard): Bytes {
  return sha256(
    concat(
      utf8("agora/v1/vouch"),
      groupId,
      fromB64u(card.key),
      fromB64u(card.box),
      utf8(card.name ?? ""),
    ),
  ) as Bytes;
}

export const DOMAIN = {
  pop: "agora/v1/sig/pop",
  vouch: "agora/v1/sig/vouch",
  key: "agora/v1/sig/key",
} as const;

export function createTag(nonce: string): Bytes {
  return concat(utf8("agora/v1/tag/create:"), fromB64u(nonce));
}

export function voteTag(groupId: Uint8Array, pollId: string): Bytes {
  return concat(utf8("agora/v1/tag/vote:"), groupId, utf8(pollId));
}

export function pledgeTag(groupId: Uint8Array, actionId: string): Bytes {
  return concat(utf8("agora/v1/tag/pledge:"), groupId, utf8(actionId));
}

export function passTag(groupId: Uint8Array, batchId: string): Bytes {
  return concat(utf8("agora/v1/tag/pass:"), groupId, utf8(batchId));
}

/** What an entry password's ring signature covers: the newcomer it lets in. */
export function passMessage(groupId: Uint8Array, card: MemberCard): Bytes {
  return sha256(
    concat(utf8("agora/v1/pass"), groupId, fromB64u(card.key), fromB64u(card.box)),
  ) as Bytes;
}

export function requestContext(groupId: Uint8Array): Bytes {
  return concat(utf8("agora/v1/request:"), groupId);
}

export function boxContext(groupId: Uint8Array, kid: string): Bytes {
  return concat(utf8("agora/v1/box:"), groupId, utf8(kid));
}

// ---------------------------------------------------------------------------
// Parsing: everything from the network is untrusted.

const B64U = /^[A-Za-z0-9_-]+$/;
const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isInt = (v: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
const isText = (v: unknown, max = MAX_TEXT, min = 0): v is string =>
  typeof v === "string" && v.length >= min && v.length <= max;

function isBin(v: unknown, len?: number): v is string {
  if (typeof v !== "string" || !B64U.test(v)) return false;
  try {
    const b = fromB64u(v);
    return len === undefined || b.length === len;
  } catch {
    return false;
  }
}

const isKey = (v: unknown): v is string => isBin(v, 32);

function isCard(v: unknown): v is MemberCard {
  if (!isObj(v) || !isKey(v.key) || !isKey(v.box)) return false;
  return v.name === undefined || isText(v.name, MAX_NAME, 1);
}

function isRing(v: unknown): v is string[] {
  if (!Array.isArray(v) || v.length === 0 || v.length > MAX_MEMBERS) return false;
  for (let i = 0; i < v.length; i++) {
    if (!isKey(v[i])) return false;
    if (i > 0 && (v[i - 1] as string) >= (v[i] as string)) return false;
  }
  return true;
}

function isChoice(v: unknown, multi: boolean, options: number): v is number[] {
  if (!Array.isArray(v) || v.length === 0 || v.length > options) return false;
  if (!multi && v.length !== 1) return false;
  for (let i = 0; i < v.length; i++) {
    if (!isInt(v[i], 0, options - 1)) return false;
    if (i > 0 && (v[i - 1] as number) >= (v[i] as number)) return false;
  }
  return true;
}

/** Shape checks only; signatures and membership are checked in ./group.ts. */
export function parseEvent(raw: unknown): AgoraEvent | null {
  if (!isObj(raw) || !isInt(raw.ts) || typeof raw.sig !== "string" || !isBin(raw.sig)) return null;
  const e = raw;
  switch (e.t) {
    case "genesis": {
      const p = e.policy;
      if (!isText(e.name, MAX_NAME, 1) || !isText(e.about) || !isCard(e.founder)) return null;
      if (!isObj(p) || !isInt(p.vouches, 0, MAX_MEMBERS) || !Array.isArray(p.issuers)) return null;
      if (p.issuers.length > 8 || !p.issuers.every((i) => isBin(i, 96))) return null;
      if (p.vouches === 0 && p.issuers.length === 0) return null;
      return raw as unknown as Genesis;
    }
    case "request":
      if (!isKey(e.to) || !isBin(e.box) || !isBin(e.sig, 64)) return null;
      if (fromB64u(e.box).length > 1024) return null;
      return raw as unknown as RequestEvent;
    case "vouch":
      if (!isCard(e.for) || !isKey(e.by) || !isBin(e.sig, 64)) return null;
      return raw as unknown as VouchEvent;
    case "admit": {
      if (!isCard(e.member) || !Array.isArray(e.vouches) || e.vouches.length > MAX_MEMBERS)
        return null;
      if (!e.vouches.every((v) => isObj(v) && isKey(v.by) && isBin(v.sig, 64))) return null;
      const t = e.ticket;
      if (t !== undefined && !(isObj(t) && isBin(t.issuer, 96) && isBin(t.sig, 48))) return null;
      const ps = e.pass;
      if (ps !== undefined && !(isObj(ps) && isText(ps.batch, 32, 32) && isBin(ps.sig)))
        return null;
      if (e.vouches.length === 0 && t === undefined && ps === undefined) return null;
      return raw as unknown as Admit;
    }
    case "passes": {
      if (!isBin(e.issuer, 96) || !isRing(e.keys) || !isBin(e.nonce, 16) || !isBin(e.sig, 48))
        return null;
      return raw as unknown as PassBatch;
    }
    case "poll": {
      if (!isText(e.q, MAX_TEXT, 1) || typeof e.multi !== "boolean" || !isInt(e.closes))
        return null;
      if (!Array.isArray(e.options) || e.options.length < 2 || e.options.length > MAX_OPTIONS)
        return null;
      if (!e.options.every((o) => isText(o, 200, 1))) return null;
      if (!isRing(e.ring) || !isBin(e.nonce, 16)) return null;
      if (e.exclude !== undefined && (!isKey(e.exclude) || e.options.length !== 2 || e.multi))
        return null;
      return raw as unknown as Poll;
    }
    case "vote":
      if (!isText(e.poll, 32, 32) || !isInt(e.seq) || !Array.isArray(e.choice)) return null;
      if (!isChoice(e.choice, true, MAX_OPTIONS)) return null;
      return raw as unknown as Vote;
    case "action":
      if (!isText(e.title, 200, 1) || !isText(e.details) || !isInt(e.closes)) return null;
      if (!isInt(e.threshold, 1, MAX_MEMBERS) || !isRing(e.ring) || !isBin(e.nonce, 16))
        return null;
      return raw as unknown as Action;
    case "pledge":
      if (!isText(e.action, 32, 32) || !isInt(e.seq) || typeof e.on !== "boolean") return null;
      return raw as unknown as Pledge;
    case "key":
      if (!isKey(e.by) || !isText(e.kid, 16, 16) || !/^[0-9a-f]+$/.test(e.kid)) return null;
      if (!Array.isArray(e.boxes) || e.boxes.length === 0 || e.boxes.length > MAX_MEMBERS)
        return null;
      if (!e.boxes.every((b) => isObj(b) && isKey(b.to) && isBin(b.box))) return null;
      return raw as unknown as KeyEvent;
    default:
      return null;
  }
}

/** A card from untrusted JSON, or null. */
export function asCard(v: unknown): MemberCard | null {
  return isCard(v) ? { key: v.key, box: v.box, ...(v.name ? { name: v.name } : {}) } : null;
}

/** A choice is valid for a given poll (the parser only knows the global bounds). */
export function validChoice(poll: Poll, choice: number[]): boolean {
  return isChoice(choice, poll.multi, poll.options.length);
}

export function b64(b: Uint8Array): string {
  return toB64u(b);
}
