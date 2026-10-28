/**
 * The crypto worker (built as its own hashed script): ring signature checks and the device
 * lock's Argon2id, with the page itself as the fallback.
 *
 * A job that never comes back (a worker the browser killed to save memory, a lost message)
 * would hold everything waiting on it: every later verification (the group would stop
 * updating), or the unlock. So each job has a deadline: past it the worker is replaced and
 * the job is done here instead. A verdict is cached for good, so it is never guessed.
 */
import { type Bytes, utf8 } from "../lib/bytes";
import { inlineRingCheck, type RingCheck, type RingJob } from "../model/verify";
import { trustedScriptUrl } from "../security";
import { diag } from "./diag";

/** A ring of 256 members takes ~130 ms on a laptop; give a slow phone plenty of room. */
const RING_TIMEOUT_MS = 4000;
/** Argon2id (19 MiB, 2 passes) takes ~0.1 s on a laptop, seconds on an old phone. */
const ARGON_TIMEOUT_MS = 30_000;

type Reply = { id: number; ok?: boolean; key?: Uint8Array; error?: string };

interface Pending {
  run: () => Promise<Reply>;
  done: (r: Reply) => void;
  timer: ReturnType<typeof setTimeout>;
}

let worker: Worker | null = null;
let broken = false;
let next = 0;
const pending = new Map<number, Pending>();

function workerUrl(): string | undefined {
  return typeof __VERIFY_URL__ === "string" && typeof Worker !== "undefined"
    ? __VERIFY_URL__
    : undefined;
}

/** Does everything still waiting here, and lets the next job start a fresh worker. */
function fallBack(reason: string): void {
  diag.workerRestarts++;
  diag.lastWorkerIssue = reason;
  worker?.terminate();
  worker = null;
  for (const [id, p] of pending) {
    clearTimeout(p.timer);
    pending.delete(id);
    void p.run().then(p.done);
  }
}

function spawn(url: string): Worker | null {
  try {
    const w = new Worker(trustedScriptUrl(new URL(url, location.href).href) as string, {
      type: "module",
    });
    w.onmessage = (e: MessageEvent<Reply>) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      clearTimeout(p.timer);
      pending.delete(e.data.id);
      p.done(e.data);
    };
    w.onerror = () => {
      // A worker that cannot even load: stop trying, work here from now on.
      broken = true;
      fallBack("worker error");
    };
    return w;
  } catch {
    broken = true;
    return null;
  }
}

/** Runs a job in the worker, or `inline` when there is none or it does not answer in time. */
function call(
  job: Record<string, unknown>,
  timeoutMs: number,
  inline: () => Promise<Reply>,
): Promise<Reply> {
  const url = workerUrl();
  if (!url || broken) return inline();
  worker ??= spawn(url);
  const w = worker;
  if (!w) return inline();
  const id = next++;
  return new Promise<Reply>((resolve) => {
    const timer = setTimeout(() => fallBack("worker timeout"), timeoutMs);
    pending.set(id, { run: inline, done: resolve, timer });
    w.postMessage({ id, ...job });
  });
}

export function ringChecker(): RingCheck {
  if (!workerUrl()) return inlineRingCheck;
  return async (job: RingJob) => {
    const r = await call({ kind: "ring", ...job }, RING_TIMEOUT_MS, async () => ({
      id: -1,
      ok: await inlineRingCheck(job),
    }));
    return r.ok === true;
  };
}

/** Argon2id for the device lock, off the page's thread (`inline` derives here instead). */
export function workerKdf(
  inline: (pass: string, salt: Uint8Array) => Promise<Bytes>,
): (pass: string, salt: Uint8Array) => Promise<Bytes> {
  if (!workerUrl()) return inline;
  return async (pass, salt) => {
    const r = await call(
      { kind: "argon2", pass: utf8(pass.normalize("NFKC")), salt },
      ARGON_TIMEOUT_MS,
      async () => ({ id: -1, key: await inline(pass, salt) }),
    );
    if (!r.key) throw new Error(r.error ?? "key derivation failed");
    return new Uint8Array(r.key) as Bytes;
  };
}
