/**
 * Optional passphrase lock for what this device keeps (group secrets, member
 * keys, organizer keys): Argon2id (19 MiB, 2 passes, OWASP's floor) then
 * XChaCha20-Poly1305. Without a passphrase the same data sits in IndexedDB
 * unencrypted, readable by anyone with the device.
 *
 * Argon2id runs once, when the lock is set or opened; the derived key (and its
 * salt) then seals every later save, which would otherwise cost a second of
 * CPU on a phone each time.
 */
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { argon2idAsync } from "@noble/hashes/argon2.js";
import { type Bytes, concat, randomBytes, utf8 } from "../lib/bytes";

export const ARGON = { t: 2, m: 19 * 1024, p: 1 } as const;
const SALT_LEN = 16;
const NONCE_LEN = 24;
const AAD = utf8("agora/v1/vault");

export interface VaultKey {
  salt: Bytes;
  key: Bytes;
}

async function derive(passphrase: string, salt: Uint8Array): Promise<Bytes> {
  return (await argon2idAsync(utf8(passphrase.normalize("NFKC")), salt, {
    ...ARGON,
    dkLen: 32,
  })) as Bytes;
}

/** A key for a new lock (fresh salt). */
export async function newVaultKey(passphrase: string): Promise<VaultKey> {
  const salt = randomBytes(SALT_LEN);
  return { salt, key: await derive(passphrase, salt) };
}

/** Layout: salt ‖ nonce ‖ ciphertext. */
export function sealVault(vk: VaultKey, data: Uint8Array): Bytes {
  const nonce = randomBytes(NONCE_LEN);
  return concat(vk.salt, nonce, xchacha20poly1305(vk.key, nonce, AAD).encrypt(data));
}

/** Opens a locked blob; throws on a wrong passphrase or tampered data. */
export async function openVault(
  passphrase: string,
  blob: Uint8Array,
): Promise<{ data: Bytes; vk: VaultKey }> {
  if (blob.length < SALT_LEN + NONCE_LEN + 16) throw new Error("vault too short");
  const salt = blob.slice(0, SALT_LEN);
  const nonce = blob.subarray(SALT_LEN, SALT_LEN + NONCE_LEN);
  const key = await derive(passphrase, salt);
  const data = xchacha20poly1305(key, nonce, AAD).decrypt(
    blob.subarray(SALT_LEN + NONCE_LEN),
  ) as Bytes;
  return { data, vk: { salt, key } };
}

export async function lock(passphrase: string, data: Uint8Array): Promise<Bytes> {
  return sealVault(await newVaultKey(passphrase), data);
}

export async function unlock(passphrase: string, blob: Uint8Array): Promise<Bytes> {
  return (await openVault(passphrase, blob)).data;
}
