/**
 * Checks ring signatures off the page's thread: a backlog of votes in a large
 * group takes seconds, and the page stays responsive meanwhile.
 */
import { ringVerify } from "./crypto/ristretto";

interface Job {
  id: number;
  msg: Uint8Array;
  ring: Uint8Array[];
  sig: Uint8Array;
  tag: Uint8Array;
}

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<Job>) => void) | null;
  postMessage(msg: { id: number; ok: boolean }): void;
};

scope.onmessage = (e) => {
  const j = e.data;
  let ok = false;
  try {
    ok = ringVerify(j.msg, j.ring, j.sig, j.tag);
  } catch {
    ok = false;
  }
  scope.postMessage({ id: j.id, ok });
};
