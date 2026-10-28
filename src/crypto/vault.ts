/**
 * Optional passphrase lock for what this device keeps (group secrets, member
 * keys, organizer keys): Argon2id (19 MiB, 2 passes, OWASP's floor) then
 * XChaCha20-Poly1305. Without a passphrase the same data sits in IndexedDB
 * unencrypted, readable by anyone with the device.
 */
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { argon2idAsync } from "@noble/hashes/argon2.js";
import { type Bytes, concat, randomBytes, utf8 } from "../lib/bytes";

export const ARGON = { t: 2, m: 19 * 1024, p: 1 } as const;
const SALT_LEN = 16;
const NONCE_LEN = 24;
const AAD = utf8("agora/v1/vault");

export async function vaultKey(passphrase: string, salt: Uint8Array): Promise<Bytes> {
  return (await argon2idAsync(utf8(passphrase.normalize("NFKC")), salt, {
    ...ARGON,
    dkLen: 32,
  })) as Bytes;
}

/** Layout: salt ‖ nonce ‖ ciphertext. */
export async function lock(passphrase: string, data: Uint8Array): Promise<Bytes> {
  const salt = randomBytes(SALT_LEN);
  const nonce = randomBytes(NONCE_LEN);
  const key = await vaultKey(passphrase, salt);
  return concat(salt, nonce, xchacha20poly1305(key, nonce, AAD).encrypt(data));
}

/** Throws on a wrong passphrase or tampered data. */
export async function unlock(passphrase: string, blob: Uint8Array): Promise<Bytes> {
  if (blob.length < SALT_LEN + NONCE_LEN + 16) throw new Error("vault too short");
  const salt = blob.subarray(0, SALT_LEN);
  const nonce = blob.subarray(SALT_LEN, SALT_LEN + NONCE_LEN);
  const key = await vaultKey(passphrase, salt);
  return xchacha20poly1305(key, nonce, AAD).decrypt(blob.subarray(SALT_LEN + NONCE_LEN)) as Bytes;
}
