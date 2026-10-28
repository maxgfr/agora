/**
 * Ring signature checks in a worker (built as its own hashed script), inline as a fallback.
 *
 * A check that never comes back (a worker the browser killed to save memory, a lost
 * message) would hold every later verification, and the group would stop updating. So each
 * job has a deadline: past it the worker is replaced and the job is checked here instead. A
 * verdict is cached for good, so it is never guessed.
 */
import { inlineRingCheck, type RingCheck, type RingJob } from "../model/verify";
import { trustedScriptUrl } from "../security";
import { diag } from "./diag";

/** A ring of 256 members takes ~130 ms on a laptop; give a slow phone plenty of room. */
const JOB_TIMEOUT_MS = 4000;

interface Pending {
  job: RingJob;
  done: (ok: boolean) => void;
  timer: ReturnType<typeof setTimeout>;
}

export function ringChecker(): RingCheck {
  const url = typeof __VERIFY_URL__ === "string" ? __VERIFY_URL__ : undefined;
  if (!url || typeof Worker === "undefined") return inlineRingCheck;
  let worker: Worker | null = null;
  let next = 0;
  const pending = new Map<number, Pending>();
  let broken = false;

  /** Checks everything still waiting here, and lets the next job start a fresh worker. */
  const fallBack = (reason: string) => {
    diag.workerRestarts++;
    diag.lastWorkerIssue = reason;
    worker?.terminate();
    worker = null;
    for (const [id, p] of pending) {
      clearTimeout(p.timer);
      pending.delete(id);
      void inlineRingCheck(p.job).then(p.done);
    }
  };

  const spawn = (): Worker | null => {
    try {
      const w = new Worker(trustedScriptUrl(new URL(url, location.href).href) as string, {
        type: "module",
      });
      w.onmessage = (e: MessageEvent<{ id: number; ok: boolean }>) => {
        const p = pending.get(e.data.id);
        if (!p) return;
        clearTimeout(p.timer);
        pending.delete(e.data.id);
        p.done(e.data.ok);
      };
      w.onerror = () => {
        // A worker that cannot even load: stop trying, check here from now on.
        broken = true;
        fallBack("worker error");
      };
      return w;
    } catch {
      broken = true;
      return null;
    }
  };

  return (job: RingJob) => {
    if (broken) return inlineRingCheck(job);
    worker ??= spawn();
    const w = worker;
    if (!w) return inlineRingCheck(job);
    const id = next++;
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => fallBack("worker timeout"), JOB_TIMEOUT_MS);
      pending.set(id, { job, done: resolve, timer });
      w.postMessage({ id, ...job });
    });
  };
}
