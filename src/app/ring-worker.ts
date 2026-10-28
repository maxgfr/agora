/** Ring signature checks in a worker (built as its own hashed script), inline as a fallback. */
import { inlineRingCheck, type RingCheck, type RingJob } from "../model/verify";
import { trustedScriptUrl } from "../security";

export function ringChecker(): RingCheck {
  const url = typeof __VERIFY_URL__ === "string" ? __VERIFY_URL__ : undefined;
  if (!url || typeof Worker === "undefined") return inlineRingCheck;
  let worker: Worker;
  try {
    worker = new Worker(trustedScriptUrl(new URL(url, location.href).href) as string, {
      type: "module",
    });
  } catch {
    return inlineRingCheck;
  }
  let next = 0;
  const pending = new Map<number, { job: RingJob; done: (ok: boolean) => void }>();
  worker.onmessage = (e: MessageEvent<{ id: number; ok: boolean }>) => {
    pending.get(e.data.id)?.done(e.data.ok);
    pending.delete(e.data.id);
  };
  let broken = false;
  // A worker that fails to load: check here instead (a verdict is cached, never guess it).
  worker.onerror = () => {
    broken = true;
    for (const p of pending.values()) void inlineRingCheck(p.job).then(p.done);
    pending.clear();
  };
  return (job: RingJob) => {
    if (broken) return inlineRingCheck(job);
    const id = next++;
    return new Promise<boolean>((resolve) => {
      pending.set(id, { job, done: resolve });
      worker.postMessage({ id, ...job });
    });
  };
}
