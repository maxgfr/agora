import { expect, test } from "bun:test";
import { withTimeout } from "./store";

test("a storage call that never answers fails after its deadline instead of hanging", async () => {
  const never = new Promise<number>(() => {});
  const started = Date.now();
  await expect(withTimeout(never, 50, "read")).rejects.toThrow("read: storage did not answer");
  expect(Date.now() - started).toBeLessThan(500);
  await expect(withTimeout(Promise.resolve(7), 50, "read")).resolves.toBe(7);
  await expect(withTimeout(Promise.reject(new Error("boom")), 50, "read")).rejects.toThrow("boom");
});
