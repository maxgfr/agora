/**
 * Blind BLS tickets (Boldyreva 2003) on BLS12-381, short signatures in G1.
 *
 * An organizer checks a person by their own means (in person, a member list,
 * an email), then signs one ticket for them without seeing it: the person
 * sends `r·H(m)`, the organizer returns `sk·r·H(m)`, the person divides by
 * `r` and holds a plain BLS signature on `m = groupId ‖ memberKey`. Anyone
 * can check it against the organizer's public key, but the organizer cannot
 * tell which of the tickets it signed this is: the admission it unlocks is
 * unlinkable to the person it checked.
 */
import { bls12_381 } from "@noble/curves/bls12-381.js";
import { type Bytes, concat, randomBytes } from "../lib/bytes";

const BLS = bls12_381.shortSignatures;
const Fr = bls12_381.fields.Fr;
const G1 = bls12_381.G1.Point;
const DST = "AGORA-V1-TICKET_BLS_SIG_BLS12381G1_XMD:SHA-256_SSWU_RO_";

export const TICKET_LEN = 48;
export const ISSUER_PUB_LEN = 96;

export interface Issuer {
  secret: Bytes;
  pub: Bytes;
}

export function issuerFromSecret(secret: Uint8Array): Issuer {
  return { secret: Uint8Array.from(secret), pub: BLS.getPublicKey(secret).toBytes() as Bytes };
}

export function newIssuer(): Issuer {
  return issuerFromSecret(BLS.keygen().secretKey);
}

function ticketPoint(groupId: Uint8Array, memberKey: Uint8Array) {
  return BLS.hash(concat(groupId, memberKey), DST);
}

function randomFr(): bigint {
  for (;;) {
    let n = 0n;
    for (const b of randomBytes(64)) n = (n << 8n) | BigInt(b);
    const r = Fr.create(n);
    if (r !== 0n) return r;
  }
}

export interface BlindRequest {
  /** What the organizer sees and signs. */
  request: Bytes;
  /** Kept by the requester to unblind the answer. */
  factor: bigint;
}

export function blindRequest(groupId: Uint8Array, memberKey: Uint8Array): BlindRequest {
  const factor = randomFr();
  return {
    request: ticketPoint(groupId, memberKey).multiply(factor).toBytes() as Bytes,
    factor,
  };
}

/** Organizer side: signs a blinded request (it never learns the member key inside). */
export function signBlinded(issuerSecret: Uint8Array, request: Uint8Array): Bytes {
  const P = G1.fromBytes(request);
  P.assertValidity();
  if (P.is0()) throw new Error("empty request");
  return BLS.sign(P, issuerSecret).toBytes() as Bytes;
}

/** Requester side: removes the blinding and checks the result; throws on a bad answer. */
export function unblind(
  answer: Uint8Array,
  factor: bigint,
  groupId: Uint8Array,
  memberKey: Uint8Array,
  issuerPub: Uint8Array,
): Bytes {
  const ticket = G1.fromBytes(answer).multiply(Fr.inv(factor)).toBytes() as Bytes;
  if (!verifyTicket(ticket, groupId, memberKey, issuerPub)) throw new Error("invalid ticket");
  return ticket;
}

export function verifyTicket(
  ticket: Uint8Array,
  groupId: Uint8Array,
  memberKey: Uint8Array,
  issuerPub: Uint8Array,
): boolean {
  if (ticket.length !== TICKET_LEN || issuerPub.length !== ISSUER_PUB_LEN) return false;
  try {
    return BLS.verify(ticket, ticketPoint(groupId, memberKey), issuerPub);
  } catch {
    return false;
  }
}
