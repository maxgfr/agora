/**
 * What people pass to each other by hand, as links, QR codes or text:
 *
 *   invitation  https://…/agora/#g=<secret>.<genesis id>  (the secret never reaches a server)
 *   card        AC2.<group ‖ key ‖ box ‖ name>   a newcomer's keys, to be vouched for
 *   request     AT2.<group ‖ blinded point>      a blind ticket request, for an organizer
 *   answer      AS2.<group ‖ blind signature>    the organizer's answer
 *   organizer   AO2.<group ‖ BLS secret>         an organizer key, for a co-organizer's device
 *
 * `group` is the 16-byte group id (not a secret): it lets the app's scanner open
 * the right group. Version 1 codes (`AC1.` …, without it) are still read.
 * Fingerprints (5 emojis) let two people compare a card over a call.
 */
import { sha256 } from "@noble/hashes/sha2.js";
import { concat, fromB64u, fromHex, fromUtf8, toB64u, toHex, utf8 } from "../lib/bytes";
import type { MemberCard } from "./events";

export interface Invitation {
  secret: Uint8Array;
  genesisId: string;
}

export function inviteFragment(inv: Invitation): string {
  return `g=${toB64u(inv.secret)}.${toB64u(fromHex(inv.genesisId))}`;
}

export function inviteLink(inv: Invitation, base = location.href): string {
  const u = new URL(base);
  u.search = "";
  u.hash = inviteFragment(inv);
  return u.href;
}

/** Accepts a whole link or just its fragment. */
export function parseInvite(text: string): Invitation | null {
  const m = /(?:^|#)g=([A-Za-z0-9_-]{43})\.([A-Za-z0-9_-]{22})\s*$/.exec(text.trim());
  if (!m) return null;
  try {
    const secret = fromB64u(m[1] as string);
    const gid = fromB64u(m[2] as string);
    if (secret.length !== 32 || gid.length !== 16) return null;
    return { secret, genesisId: toHex(gid) };
  } catch {
    return null;
  }
}

function prefixed(prefix: string, text: string): Uint8Array | null {
  const s = text.replace(/\s+/g, "");
  if (!s.startsWith(prefix)) return null;
  try {
    return fromB64u(s.slice(prefix.length));
  } catch {
    return null;
  }
}

/** A code, and the group it names (absent in version 1 codes). */
export interface Scoped<T> {
  value: T;
  groupId?: string;
}

const GID = 16;

function scoped(v1: string, v2: string, text: string): Scoped<Uint8Array> | null {
  const b2 = prefixed(v2, text);
  if (b2)
    return b2.length > GID ? { value: b2.slice(GID), groupId: toHex(b2.subarray(0, GID)) } : null;
  const b1 = prefixed(v1, text);
  return b1 ? { value: b1 } : null;
}

const withGroup = (prefix: string, groupId: string, data: Uint8Array) =>
  `${prefix}${toB64u(concat(fromHex(groupId), data))}`;

export function cardCode(card: MemberCard, groupId: string): string {
  return withGroup(
    "AC2.",
    groupId,
    concat(fromB64u(card.key), fromB64u(card.box), utf8(card.name ?? "")),
  );
}

export function parseCard(text: string): Scoped<MemberCard> | null {
  const s = scoped("AC1.", "AC2.", text);
  const b = s?.value;
  if (!s || !b || b.length < 64 || b.length > 64 + 256) return null;
  try {
    const card: MemberCard = {
      key: toB64u(b.subarray(0, 32)),
      box: toB64u(b.subarray(32, 64)),
    };
    const name = fromUtf8(b.subarray(64)).trim();
    if (name) card.name = name.slice(0, 64);
    return s.groupId ? { value: card, groupId: s.groupId } : { value: card };
  } catch {
    return null;
  }
}

export const requestCode = (groupId: string, request: Uint8Array) =>
  withGroup("AT2.", groupId, request);
export const answerCode = (groupId: string, answer: Uint8Array) =>
  withGroup("AS2.", groupId, answer);
export const organizerCode = (groupId: string, secret: Uint8Array) =>
  withGroup("AO2.", groupId, secret);

function fixed(v1: string, v2: string, len: number) {
  return (text: string): Scoped<Uint8Array> | null => {
    const s = scoped(v1, v2, text);
    return s && s.value.length === len ? s : null;
  };
}

export const parseRequest = fixed("AT1.", "AT2.", 48);
export const parseAnswer = fixed("AS1.", "AS2.", 48);
export const parseOrganizer = fixed("AO1.", "AO2.", 32);

/** Whatever the app's scanner read. */
export type ScannedCode =
  | { kind: "invite"; invite: Invitation }
  | { kind: "card"; code: Scoped<MemberCard> }
  | { kind: "request" | "answer" | "organizer"; code: Scoped<Uint8Array> };

export function classifyCode(text: string): ScannedCode | null {
  const invite = parseInvite(text);
  if (invite) return { kind: "invite", invite };
  const card = parseCard(text);
  if (card) return { kind: "card", code: card };
  for (const [kind, parse] of [
    ["request", parseRequest],
    ["answer", parseAnswer],
    ["organizer", parseOrganizer],
  ] as const) {
    const code = parse(text);
    if (code) return { kind, code };
  }
  return null;
}

const EMOJI = [
  ..."🍎🍊🍋🍉🍇🍓🍒🍑🥝🥥🥑🍆🥕🌽🌶🥦🍄🥜🌰🍞🧀🥚🍕🍔🌮🍩🍪🎂🍫🍿🧁🍯🐶🐱🦊🐻🐼🐨🐯🦁🐮🐷🐸🐵🐔🐧🐦🦆🦉🐺🐴🦄🐝🦋🐌🐞🐢🐍🐙🦀🐬🐳🌵🌻⭐",
];

/** Five emojis from the card's hash, for both sides to compare. */
export function fingerprint(card: MemberCard): string {
  const h = sha256(concat(utf8("agora/v1/fingerprint"), fromB64u(card.key), fromB64u(card.box)));
  return Array.from(h.subarray(0, 5), (b) => EMOJI[b % EMOJI.length]).join(" ");
}
