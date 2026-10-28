import { type Browser, type BrowserContext, expect, type Page } from "@playwright/test";

export const PORT = Number(process.env.AGORA_E2E_PORT ?? 4173);
export const HOST = `localhost:${PORT}`;
export const BASE = `http://${HOST}`;

/** Local relay only, no tracker, no STUN: tests never touch the public network. */
export function settingsJson(extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    relays: [`ws://${HOST}/relay`],
    trackers: [`ws://${HOST}/tracker`],
    nostr: true,
    torrent: false,
    stun: [],
    turn: null,
    relayOnly: false,
    ...extra,
  });
}

export interface Person {
  name: string;
  ctx: BrowserContext;
  page: Page;
  errors: string[];
}

export async function person(
  browser: Browser,
  name: string,
  settings: Record<string, unknown> = {},
): Promise<Person> {
  const ctx = await browser.newContext({ locale: "en-US" });
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"]);
  await ctx.addInitScript(
    ({ s }) => {
      try {
        if (sessionStorage.getItem("agora.test.seeded")) return;
        localStorage.setItem("agora.settings.v1", s);
        localStorage.setItem("agora.lang", "en");
        sessionStorage.setItem("agora.test.seeded", "1");
      } catch {
        // about:blank (going back past the app's first page) has no storage
      }
    },
    { s: settingsJson(settings) },
  );
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => void d.accept());
  if (process.env.AGORA_E2E_VERBOSE)
    page.on("console", (m) => console.log(`[${name}] ${m.text()}`));
  return { name, ctx, page, errors };
}

/** Opens the app (no service worker, so every run tests the fresh build). */
export async function open(p: Person, hash = ""): Promise<void> {
  await p.page.goto(`${BASE}/?nosw${hash}`);
  await expect(p.page.locator(".wordmark")).toBeVisible();
}

export async function text(p: Person, testId: string): Promise<string> {
  const el = p.page.getByTestId(testId);
  await expect(el).toBeVisible();
  return ((await el.textContent()) ?? "").trim();
}

export async function tab(p: Person, name: "Polls" | "Actions" | "Members") {
  await p.page.getByRole("navigation").getByRole("link", { name, exact: true }).click();
}

/** Founds a group from the home screen; returns its invitation fragment (`#g=…`). */
export async function found(
  p: Person,
  name: string,
  opts: { vouches?: number; tickets?: boolean } = {},
): Promise<string> {
  await p.page.getByRole("link", { name: "Create a group" }).click();
  await p.page.getByLabel("Group name").fill(name);
  await p.page.getByLabel("Your pseudonym in the group").fill(p.name);
  await p.page.getByLabel("Vouches needed").fill(String(opts.vouches ?? 1));
  if (opts.tickets) await p.page.getByTestId("ticket-mode").check();
  await p.page.getByRole("button", { name: "Create the group" }).click();
  await expect(p.page.getByTestId("group-name")).toHaveText(name);
  const link = await text(p, "invite-link");
  return link.slice(link.indexOf("#"));
}

export async function close(...people: Person[]): Promise<void> {
  for (const p of people) {
    expect(p.errors, `no uncaught errors for ${p.name}`).toEqual([]);
    await p.ctx.close();
  }
}
