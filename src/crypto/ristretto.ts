/**
 * Member keys live in ristretto255 (RFC 9496): a prime-order group, so ring
 * signatures and key images have no cofactor pitfalls. Two schemes use them:
 *
 *  - Schnorr signatures, for what a member signs under their own key (the
 *    proof of possession in an admission, a vouch for a newcomer, a rekey).
 *  - LSAG linkable ring signatures with an event tag: a signature proves that
 *    one key of the ring signed, without saying which, and carries a key
 *    image `I = x·H_p(tag)`. The same key signing twice under the same tag
 *    gives the same image (one vote per poll); under two tags the images are
 *    unrelated (votes in two polls cannot be linked).
 */
import { ristretto255, ristretto255_hasher } from "@noble/curves/ed25519.js";
import { sha512 } from "@noble/hashes/sha2.js";
import { type Bytes, concat, randomBytes, u32, utf8 } from "../lib/bytes";

export const Point = ristretto255.Point;
export type RPoint = InstanceType<typeof Point>;
const ORDER = Point.Fn.ORDER;

export const POINT_LEN = 32;
export const SCALAR_LEN = 32;

function leToBig(b: Uint8Array): bigint {
  let n = 0n;
  for (let i = b.length - 1; i >= 0; i--) n = (n << 8n) | BigInt(b[i] as number);
  return n;
}

export function scalarToBytes(s: bigint): Bytes {
  const out = new Uint8Array(SCALAR_LEN);
  let n = s;
  for (let i = 0; i < SCALAR_LEN; i++) {
    out[i] = Number(n & 0xffn);
    n >>= 8n;
  }
  return out;
}

/** Canonical scalars only: one signature has one encoding. */
export function scalarFromBytes(b: Uint8Array): bigint {
  if (b.length !== SCALAR_LEN) throw new Error("invalid scalar length");
  const n = leToBig(b);
  if (n >= ORDER) throw new Error("non-canonical scalar");
  return n;
}

const mod = (n: bigint) => ((n % ORDER) + ORDER) % ORDER;

/** A uniform nonzero scalar (64 bytes reduced, so the bias is negligible). */
export function randomScalar(): bigint {
  for (;;) {
    const s = mod(leToBig(randomBytes(64)));
    if (s !== 0n) return s;
  }
}

/** Hash of length-prefixed parts under a domain, reduced to a scalar. */
export function hashToScalar(domain: string, ...parts: Uint8Array[]): bigint {
  const chunks: Uint8Array[] = [];
  for (const p of [utf8(domain), ...parts]) chunks.push(u32(p.length), p);
  return mod(leToBig(sha512(concat(...chunks))));
}

export function hashToPoint(domain: string, data: Uint8Array): RPoint {
  return ristretto255_hasher.hashToCurve(data, { DST: domain });
}

export function pointFromBytes(b: Uint8Array): RPoint {
  if (b.length !== POINT_LEN) throw new Error("invalid point length");
  const p = Point.fromBytes(b);
  if (p.is0()) throw new Error("identity point");
  return p;
}

export interface KeyPair {
  secret: bigint;
  pub: Bytes;
}

export function keyPairFromSeed(seed: Uint8Array): KeyPair {
  let secret = hashToScalar("agora/v1/member-key", seed);
  if (secret === 0n) secret = 1n;
  return { secret, pub: Point.BASE.multiply(secret).toBytes() as Bytes };
}

// ---------------------------------------------------------------------------
// Schnorr

export const SCHNORR_LEN = POINT_LEN + SCALAR_LEN;

export function schnorrSign(domain: string, secret: bigint, msg: Uint8Array): Bytes {
  const pub = Point.BASE.multiply(secret).toBytes();
  // Hedged nonce: deterministic in the key and message, plus fresh randomness.
  let k = hashToScalar("agora/v1/nonce", scalarToBytes(secret), msg, randomBytes(32));
  if (k === 0n) k = 1n;
  const R = Point.BASE.multiply(k).toBytes();
  const c = hashToScalar(domain, R, pub, msg);
  return concat(R, scalarToBytes(mod(k + c * secret)));
}

export function schnorrVerify(
  domain: string,
  pub: Uint8Array,
  msg: Uint8Array,
  sig: Uint8Array,
): boolean {
  if (sig.length !== SCHNORR_LEN) return false;
  try {
    const P = pointFromBytes(pub);
    const Rb = sig.subarray(0, POINT_LEN);
    const R = Point.fromBytes(Rb);
    const s = scalarFromBytes(sig.subarray(POINT_LEN));
    const c = hashToScalar(domain, Rb, pub, msg);
    return Point.BASE.multiplyUnsafe(s).equals(R.add(P.multiplyUnsafe(c)));
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// LSAG with an event tag

/** The tag's base point: all members share it, so one key gives one image per tag. */
export function tagBase(tag: Uint8Array): RPoint {
  return hashToPoint("agora/v1/lsag-tag", tag);
}

export function ringSigLen(n: number): number {
  return POINT_LEN + SCALAR_LEN * (n + 1);
}

function ringDigest(ring: readonly Uint8Array[]): Bytes {
  return sha512(concat(u32(ring.length), ...ring)) as Bytes;
}

function challenge(
  digest: Uint8Array,
  base: Uint8Array,
  image: Uint8Array,
  msg: Uint8Array,
  L: RPoint,
  R: RPoint,
): bigint {
  return hashToScalar("agora/v1/lsag", digest, base, image, msg, L.toBytes(), R.toBytes());
}

/**
 * Signs `msg` as one of `ring` (encoded public keys, `ring[index]` is ours) under `tag`.
 * Layout: image ‖ c0 ‖ s0 … s(n-1).
 */
export function ringSign(
  msg: Uint8Array,
  ring: readonly Uint8Array[],
  index: number,
  secret: bigint,
  tag: Uint8Array,
): Bytes {
  const n = ring.length;
  if (n === 0 || index < 0 || index >= n) throw new Error("bad ring index");
  const points = ring.map(pointFromBytes);
  if (!points[index]?.equals(Point.BASE.multiply(secret))) throw new Error("key not in ring");
  const H = tagBase(tag);
  const Hb = H.toBytes();
  const I = H.multiply(secret);
  const Ib = I.toBytes();
  const digest = ringDigest(ring);
  const c: bigint[] = new Array(n).fill(0n);
  const s: bigint[] = new Array(n).fill(0n);
  const alpha = randomScalar();
  c[(index + 1) % n] = challenge(
    digest,
    Hb,
    Ib,
    msg,
    Point.BASE.multiply(alpha),
    H.multiply(alpha),
  );
  for (let k = 1; k < n; k++) {
    const i = (index + k) % n;
    const si = randomScalar();
    s[i] = si;
    const ci = c[i] as bigint;
    const P = points[i] as RPoint;
    const L = Point.BASE.multiply(si).add(P.multiplyUnsafe(ci));
    const R = H.multiply(si).add(I.multiplyUnsafe(ci));
    c[(i + 1) % n] = challenge(digest, Hb, Ib, msg, L, R);
  }
  s[index] = mod(alpha - (c[index] as bigint) * secret);
  return concat(Ib, scalarToBytes(c[0] as bigint), ...s.map(scalarToBytes));
}

/** The key image of a ring signature (its first 32 bytes), as is. */
export function ringImage(sig: Uint8Array): Bytes {
  return sig.slice(0, POINT_LEN);
}

export function ringVerify(
  msg: Uint8Array,
  ring: readonly Uint8Array[],
  sig: Uint8Array,
  tag: Uint8Array,
): boolean {
  const n = ring.length;
  if (n === 0 || sig.length !== ringSigLen(n)) return false;
  try {
    const points = ring.map(pointFromBytes);
    const Ib = sig.subarray(0, POINT_LEN);
    const I = pointFromBytes(Ib);
    const H = tagBase(tag);
    const Hb = H.toBytes();
    const digest = ringDigest(ring);
    const c0 = scalarFromBytes(sig.subarray(POINT_LEN, POINT_LEN + SCALAR_LEN));
    let c = c0;
    for (let i = 0; i < n; i++) {
      const off = POINT_LEN + SCALAR_LEN * (i + 1);
      const si = scalarFromBytes(sig.subarray(off, off + SCALAR_LEN));
      const L = Point.BASE.multiplyUnsafe(si).add((points[i] as RPoint).multiplyUnsafe(c));
      const R = H.multiplyUnsafe(si).add(I.multiplyUnsafe(c));
      c = challenge(digest, Hb, Ib, msg, L, R);
    }
    return c === c0;
  } catch {
    return false;
  }
}

/** The key image `secret` gives under `tag`: how a member recognizes their own vote. */
export function keyImage(secret: bigint, tag: Uint8Array): Bytes {
  return tagBase(tag).multiply(secret).toBytes() as Bytes;
}
