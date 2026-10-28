/**
 * What people pass to each other by hand, as links, QR codes or text:
 *
 *   invitation  https://…/agora/#g=<secret>.<genesis id>  (the secret never reaches a server)
 *   card        AC1.<key ‖ box ‖ name>     a newcomer's keys, to be vouched for
 *   request     AT1.<blinded point>        a blind ticket request, for an organizer
 *   answer      AS1.<blind signature>      the organizer's answer
 *   organizer   AO1.<BLS secret>           an organizer key, for a co-organizer's device
 *
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

export function cardCode(card: MemberCard): string {
  return `AC1.${toB64u(concat(fromB64u(card.key), fromB64u(card.box), utf8(card.name ?? "")))}`;
}

export function parseCard(text: string): MemberCard | null {
  const b = prefixed("AC1.", text);
  if (!b || b.length < 64 || b.length > 64 + 256) return null;
  try {
    const card: MemberCard = {
      key: toB64u(b.subarray(0, 32)),
      box: toB64u(b.subarray(32, 64)),
    };
    const name = fromUtf8(b.subarray(64)).trim();
    if (name) card.name = name.slice(0, 64);
    return card;
  } catch {
    return null;
  }
}

export const requestCode = (request: Uint8Array) => `AT1.${toB64u(request)}`;
export const answerCode = (answer: Uint8Array) => `AS1.${toB64u(answer)}`;
export const organizerCode = (secret: Uint8Array) => `AO1.${toB64u(secret)}`;

function fixed(prefix: string, len: number) {
  return (text: string): Uint8Array | null => {
    const b = prefixed(prefix, text);
    return b && b.length === len ? b : null;
  };
}

export const parseRequest = fixed("AT1.", 48);
export const parseAnswer = fixed("AS1.", 48);
export const parseOrganizer = fixed("AO1.", 32);

const EMOJI = [
  ..."🍎🍊🍋🍉🍇🍓🍒🍑🥝🥥🥑🍆🥕🌽🌶🥦🍄🥜🌰🍞🧀🥚🍕🍔🌮🍩🍪🎂🍫🍿🧁🍯🐶🐱🦊🐻🐼🐨🐯🦁🐮🐷🐸🐵🐔🐧🐦🦆🦉🐺🐴🦄🐝🦋🐌🐞🐢🐍🐙🦀🐬🐳🌵🌻⭐",
];

/** Five emojis from the card's hash, for both sides to compare. */
export function fingerprint(card: MemberCard): string {
  const h = sha256(concat(utf8("agora/v1/fingerprint"), fromB64u(card.key), fromB64u(card.box)));
  return Array.from(h.subarray(0, 5), (b) => EMOJI[b % EMOJI.length]).join(" ");
}
