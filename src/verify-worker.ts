/**
 * The page's crypto worker: ring signature checks (a backlog of votes in a large group takes
 * seconds) and Argon2id for the device lock (half a second of solid CPU on a phone), both off
 * the page's thread so it stays responsive meanwhile.
 */
import { argon2id } from "@noble/hashes/argon2.js";
import { ringVerify } from "./crypto/ristretto";
import { ARGON } from "./crypto/vault";

type Job =
  | {
      id: number;
      kind: "ring";
      msg: Uint8Array;
      ring: Uint8Array[];
      sig: Uint8Array;
      tag: Uint8Array;
    }
  | { id: number; kind: "argon2"; pass: Uint8Array; salt: Uint8Array };

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<Job>) => void) | null;
  postMessage(msg: { id: number; ok?: boolean; key?: Uint8Array; error?: string }): void;
};

scope.onmessage = (e) => {
  const j = e.data;
  if (j.kind === "argon2") {
    try {
      scope.postMessage({ id: j.id, key: argon2id(j.pass, j.salt, { ...ARGON, dkLen: 32 }) });
    } catch (err) {
      scope.postMessage({ id: j.id, error: String(err) });
    }
    return;
  }
  let ok = false;
  try {
    ok = ringVerify(j.msg, j.ring, j.sig, j.tag);
  } catch {
    ok = false;
  }
  scope.postMessage({ id: j.id, ok });
};
