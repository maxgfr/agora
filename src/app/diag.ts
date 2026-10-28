/**
 * Diagnostics, for "it froze for a moment" reports: how long the page's main thread was
 * blocked (measured by timer drift), worker restarts, storage failures, reconnections. Kept in memory only, shown in
 * Settings; nothing about groups, members or votes is in it.
 */
import { signal } from "@preact/signals";

export interface Block {
  at: number;
  ms: number;
}

export const diag = {
  startedAt: Date.now(),
  workerRestarts: 0,
  lastWorkerIssue: "",
  storageErrors: 0,
  lastStorageError: "",
  reconnects: 0,
};

/** The longest main-thread blocks seen (at most 20), newest first. */
export const blocks = signal<Block[]>([]);

const TICK_MS = 250;
/** Below this a stall is not worth noting. */
const NOTE_MS = 300;

function note(ms: number): void {
  if (ms < NOTE_MS) return;
  blocks.value = [{ at: Date.now(), ms: Math.round(ms) }, ...blocks.value].slice(0, 20);
}

export function storageError(err: unknown): void {
  diag.storageErrors++;
  diag.lastStorageError = err instanceof Error ? err.message : String(err);
}

let started = false;

export function startDiagnostics(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  // A timer that fires late means the main thread was busy (works in every browser).
  let last = performance.now();
  document.addEventListener("visibilitychange", () => {
    // Background tabs have their timers slowed down: that is not a freeze.
    last = performance.now();
  });
  setInterval(() => {
    const now = performance.now();
    if (!document.hidden) note(now - last - TICK_MS);
    last = now;
  }, TICK_MS);
}

/** A plain-text report to paste in an issue (no secrets, no names, no votes). */
export function report(extra: Record<string, unknown>): string {
  return JSON.stringify(
    {
      app: typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "dev",
      ua: navigator.userAgent,
      upMinutes: Math.round((Date.now() - diag.startedAt) / 60_000),
      ...diag,
      blocks: blocks.value.map((b) => ({ ago: Math.round((Date.now() - b.at) / 1000), ms: b.ms })),
      ...extra,
    },
    null,
    2,
  );
}
