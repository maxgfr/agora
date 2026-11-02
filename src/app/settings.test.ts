import { afterEach, expect, test } from "bun:test";
import { forgetOwnKeys, saveSettings, settings } from "./settings";

class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  full = false;
  get length() {
    return this.map.size;
  }
  clear() {
    this.map.clear();
  }
  getItem(key: string) {
    return this.map.get(key) ?? null;
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null;
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
  setItem(key: string, value: string) {
    if (this.full) throw new DOMException("quota", "QuotaExceededError");
    this.map.set(key, value);
  }
}

const g = globalThis as { localStorage?: Storage | undefined };
const original = g.localStorage;
afterEach(() => {
  g.localStorage = original;
});

test("saving reports whether the preferences were stored", () => {
  const storage = new MemoryStorage();
  g.localStorage = storage;
  expect(saveSettings({ relayOnly: true })).toBe(true);
  expect(JSON.parse(storage.getItem("agora.settings.v1") ?? "{}").relayOnly).toBe(true);

  // Another site of the shared origin filled the quota: the change applies, but says so.
  storage.full = true;
  expect(saveSettings({ relayOnly: false })).toBe(false);
  expect(settings.value.relayOnly).toBe(false);
});

test("erasing removes agora's keys only, never another site's", () => {
  const storage = new MemoryStorage();
  storage.setItem("agora.settings.v1", "{}");
  storage.setItem("agora.lang", "en");
  storage.setItem("agora.locked", "1");
  storage.setItem("theme", "dark");
  storage.setItem("goodscan:settings", "{}");
  forgetOwnKeys(storage);
  expect(storage.length).toBe(2);
  expect(storage.getItem("theme")).toBe("dark");
  expect(storage.getItem("goodscan:settings")).toBe("{}");
});
