/**
 * Symmetric layer. A group is a 32-byte secret carried in the #fragment of
 * its invitation link (never sent to a server). From it come:
 *
 *  - `groupId`: names the group inside signatures and tickets;
 *  - `topic`: the opaque tag relays index the group's events under (and
 *    `signalTopic`, where its devices meet for peer-to-peer links);
 *  - the link key: encrypts the group's events until a rekey replaces it.
 *
 * Every event is XChaCha20-Poly1305 over a padded plaintext, prefixed by the
 * id of the key that sealed it, so readers holding several keys (one per
 * rekey) pick the right one. Boxes seal a new key to one member's X25519 key.
 */
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { x25519 } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { type Bytes, concat, fromHex, randomBytes, readU32, toHex, u32, utf8 } from "../lib/bytes";

export const VERSION = 1;
export const KEY_ID_LEN = 8;
const NONCE_LEN = 24;
const HEADER_LEN = 1 + KEY_ID_LEN + NONCE_LEN;
/** Largest plaintext an event may carry (a vote over 1000 members is about 32 KiB). */
export const MAX_PLAINTEXT = 96 * 1024;

const derive = (ikm: Uint8Array, info: string, len = 32) =>
  hkdf(sha256, ikm, undefined, utf8(info), len) as Bytes;

export interface GroupKeys {
  secret: Bytes;
  groupId: Bytes;
  topic: Bytes;
  /** Where the group's devices meet to open peer-to-peer links. */
  signalTopic: Bytes;
  linkKey: Bytes;
}

export function groupKeys(secret: Uint8Array): GroupKeys {
  if (secret.length !== 32) throw new Error("group secret must be 32 bytes");
  return {
    secret: Uint8Array.from(secret),
    groupId: derive(secret, "agora/v1/group-id", 16),
    topic: derive(secret, "agora/v1/topic"),
    signalTopic: derive(secret, "agora/v1/signal-topic"),
    linkKey: derive(secret, "agora/v1/link-key"),
  };
}

export function keyId(key: Uint8Array): string {
  return toHex(sha256(concat(utf8("agora/v1/key-id"), key)).subarray(0, KEY_ID_LEN));
}

/**
 * Pads to the next power of two (at least 256 bytes), so sizes only leak a bucket.
 * Layout: u32 length ‖ data ‖ zeros.
 */
export function pad(data: Uint8Array): Bytes {
  let size = 256;
  while (size < data.length + 4) size *= 2;
  const out = new Uint8Array(size);
  out.set(u32(data.length), 0);
  out.set(data, 4);
  return out;
}

export function unpad(padded: Uint8Array): Bytes {
  if (padded.length < 4) throw new Error("bad padding");
  const len = readU32(padded, 0);
  if (len > padded.length - 4) throw new Error("bad padding");
  for (let i = 4 + len; i < padded.length; i++) if (padded[i] !== 0) throw new Error("bad padding");
  return padded.slice(4, 4 + len);
}

export function seal(key: Uint8Array, groupId: Uint8Array, plaintext: Uint8Array): Bytes {
  if (plaintext.length > MAX_PLAINTEXT) throw new Error("event too large");
  const header = new Uint8Array(HEADER_LEN);
  header[0] = VERSION;
  header.set(fromHex(keyId(key)), 1);
  header.set(randomBytes(NONCE_LEN), 1 + KEY_ID_LEN);
  const nonce = header.subarray(1 + KEY_ID_LEN);
  const ct = xchacha20poly1305(key, nonce, concat(header, groupId)).encrypt(pad(plaintext));
  return concat(header, ct);
}

/** Opens a sealed event with whichever of `keys` (by key id) sealed it; throws otherwise. */
export function open(
  keys: ReadonlyMap<string, Uint8Array>,
  groupId: Uint8Array,
  sealed: Uint8Array,
): Bytes {
  if (sealed.length < HEADER_LEN + 16 || sealed[0] !== VERSION) throw new Error("bad envelope");
  const header = sealed.subarray(0, HEADER_LEN);
  const key = keys.get(toHex(header.subarray(1, 1 + KEY_ID_LEN)));
  if (!key) throw new Error("unknown key");
  const nonce = header.subarray(1 + KEY_ID_LEN);
  const padded = xchacha20poly1305(key, nonce, concat(header, groupId)).decrypt(
    sealed.subarray(HEADER_LEN),
  );
  return unpad(padded);
}

/** The key id an envelope claims (to tell "not for us yet" from "garbage"). */
export function envelopeKeyId(sealed: Uint8Array): string | null {
  if (sealed.length < HEADER_LEN || sealed[0] !== VERSION) return null;
  return toHex(sealed.subarray(1, 1 + KEY_ID_LEN));
}

// ---------------------------------------------------------------------------
// Boxes: a key sealed to one member's X25519 public key.

export function boxKeyPair(seed: Uint8Array): { secret: Bytes; pub: Bytes } {
  const secret = derive(seed, "agora/v1/member-box");
  return { secret, pub: x25519.getPublicKey(secret) as Bytes };
}

export function boxSeal(toPub: Uint8Array, data: Uint8Array, context: Uint8Array): Bytes {
  const eph = x25519.utils.randomSecretKey();
  const ephPub = x25519.getPublicKey(eph);
  const shared = x25519.getSharedSecret(eph, toPub);
  const key = hkdf(sha256, shared, concat(ephPub, toPub), utf8("agora/v1/box"), 32);
  const nonce = randomBytes(NONCE_LEN);
  const ct = xchacha20poly1305(key, nonce, context).encrypt(data);
  return concat(ephPub, nonce, ct);
}

export function boxOpen(secret: Uint8Array, box: Uint8Array, context: Uint8Array): Bytes | null {
  if (box.length < 32 + NONCE_LEN + 16) return null;
  try {
    const ephPub = box.subarray(0, 32);
    const pub = x25519.getPublicKey(secret);
    const shared = x25519.getSharedSecret(secret, ephPub);
    const key = hkdf(sha256, shared, concat(ephPub, pub), utf8("agora/v1/box"), 32);
    const nonce = box.subarray(32, 32 + NONCE_LEN);
    return xchacha20poly1305(key, nonce, context).decrypt(box.subarray(32 + NONCE_LEN)) as Bytes;
  } catch {
    return null;
  }
}
