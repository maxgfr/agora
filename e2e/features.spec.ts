/**
 * Every feature not walked through elsewhere: the device lock, language, multiple choice,
 * withdrawing a pledge, ignoring a request, a co-organizer's desk, a delayed admission,
 * exclusion (with the clock moved forward), leaving, settings, erasing, and sync with no
 * relay at all (peer to peer only).
 */
import { expect, type Page, test } from "@playwright/test";
import { close, found, HOST, open, type Person, person, tab, text } from "./helpers";

const nav = (p: Person, name: string) =>
  p.page.getByRole("navigation").getByRole("link", { name, exact: true });

async function admitted(p: Person): Promise<void> {
  await expect(nav(p, "Polls")).toBeVisible({ timeout: 30_000 });
}

async function joinAndVouch(founder: Person, p: Person, fragment: string): Promise<void> {
  await open(p, fragment);
  await p.page.getByTestId("join-name").fill(p.name);
  await p.page.getByRole("button", { name: "Join", exact: true }).click();
  const card = await text(p, "my-card");
  await tab(founder, "Members");
  await founder.page.getByText("Paste their code", { exact: true }).click();
  await founder.page.getByTestId("card-input").fill(card);
  await founder.page.getByRole("button", { name: "Check the card" }).click();
  await founder.page.getByTestId("confirm-vouch").click();
  await admitted(p);
}

async function newPoll(p: Person, q: string, options: string[], multi = false): Promise<void> {
  await tab(p, "Polls");
  await p.page.getByRole("button", { name: "+ New poll" }).click();
  await p.page.getByTestId("poll-q").fill(q);
  for (let i = 0; i < options.length; i++) {
    if (i >= 2) await p.page.getByRole("button", { name: "+ Add an answer" }).click();
    await p.page.getByTestId(`poll-option-${i}`).fill(options[i] as string);
  }
  if (multi) await p.page.getByLabel("Several answers allowed").check();
  await p.page.getByRole("button", { name: "Publish" }).click();
}

async function openPoll(p: Person, q: string): Promise<void> {
  await tab(p, "Polls");
  await p.page.getByTestId("polls").getByText(q).click();
  await expect(p.page.getByTestId("poll-title")).toContainText(q);
}

const counts = (page: Page, n: number) =>
  Promise.all(Array.from({ length: n }, (_, i) => page.getByTestId(`count-${i}`).textContent()));

test("device lock: wrong passphrase refused, right one opens, lock removed", async ({
  browser,
}) => {
  const ada = await person(browser, "Ada");
  await open(ada);
  await found(ada, "Locked club");
  await ada.page.getByRole("link", { name: "Settings" }).click();
  await ada.page.getByLabel("Passphrase", { exact: true }).fill("correct horse battery");
  await ada.page.getByLabel("Repeat it").fill("correct horse battery");
  await ada.page.getByRole("button", { name: "Lock", exact: true }).click();
  await expect(ada.page.getByText("Lock on.")).toBeVisible();

  await open(ada);
  await expect(ada.page.getByRole("heading", { name: "Unlock" })).toBeVisible();
  await ada.page.getByLabel("Passphrase").fill("wrong horse");
  await ada.page.getByRole("button", { name: "Unlock" }).click();
  await expect(ada.page.getByText("Wrong passphrase.")).toBeVisible();
  await ada.page.getByLabel("Passphrase").fill("correct horse battery");
  await ada.page.getByRole("button", { name: "Unlock" }).click();
  await expect(ada.page.getByTestId("groups")).toContainText("Locked club");

  await ada.page.getByRole("link", { name: "Settings" }).click();
  // Reloading the very moment the lock is removed must never lose the profile: either the
  // rewrite made it (plain), or it did not (still locked, the passphrase opens it).
  await ada.page.getByRole("button", { name: "Remove the lock" }).click();
  await open(ada);
  const unlock = ada.page.getByRole("heading", { name: "Unlock" });
  const groups = ada.page.getByTestId("groups");
  await expect(unlock.or(groups)).toBeVisible();
  if (await unlock.isVisible()) {
    await ada.page.getByLabel("Passphrase").fill("correct horse battery");
    await ada.page.getByRole("button", { name: "Unlock" }).click();
  }
  await expect(groups).toContainText("Locked club");
  // Removed for good once the settings say so.
  await ada.page.getByRole("link", { name: "Settings" }).click();
  if (await ada.page.getByRole("button", { name: "Remove the lock" }).isVisible())
    await ada.page.getByRole("button", { name: "Remove the lock" }).click();
  await expect(ada.page.getByRole("button", { name: "Lock", exact: true })).toBeVisible();
  await open(ada);
  await expect(ada.page.getByTestId("groups")).toContainText("Locked club");
  await close(ada);
});

test("a forgotten passphrase: erase the device and start over", async ({ browser }) => {
  const ada = await person(browser, "Ada");
  await open(ada);
  await found(ada, "Forgotten");
  await ada.page.getByRole("link", { name: "Settings" }).click();
  await ada.page.getByLabel("Passphrase", { exact: true }).fill("long enough phrase");
  await ada.page.getByLabel("Repeat it").fill("long enough phrase");
  await ada.page.getByRole("button", { name: "Lock", exact: true }).click();
  await expect(ada.page.getByText("Lock on.")).toBeVisible();
  await open(ada);
  await ada.page.getByText("Forgot the passphrase?").click();
  await ada.page.getByRole("button", { name: "Erase everything on this device" }).click();
  await expect(ada.page.getByText("No groups yet.")).toBeVisible();
  await close(ada);
});

test("language switch, kept across reloads", async ({ browser }) => {
  const ada = await person(browser, "Ada");
  await open(ada);
  await ada.page.getByRole("button", { name: "Language" }).click();
  await expect(ada.page.getByRole("link", { name: "Créer un groupe" })).toBeVisible();
  await open(ada);
  await expect(ada.page.getByRole("link", { name: "Créer un groupe" })).toBeVisible();
  await expect(ada.page.locator("html")).toHaveAttribute("lang", "fr");
  await close(ada);
});

test("multiple choice, a withdrawn pledge, an ignored request, leaving", async ({ browser }) => {
  const ada = await person(browser, "Ada");
  const bob = await person(browser, "Bob");
  const zoe = await person(browser, "Zoe");
  await open(ada);
  const fragment = await found(ada, "Choices");
  await joinAndVouch(ada, bob, fragment);

  await newPoll(ada, "Which days?", ["Mon", "Tue", "Wed"], true);
  await openPoll(ada, "Which days?");
  await ada.page.getByRole("checkbox", { name: "Mon" }).check();
  await ada.page.getByRole("checkbox", { name: "Wed" }).check();
  await ada.page.getByRole("button", { name: "Vote", exact: true }).click();
  await openPoll(bob, "Which days?");
  await bob.page.getByRole("checkbox", { name: "Wed" }).check();
  await bob.page.getByRole("button", { name: "Vote", exact: true }).click();
  await expect(ada.page.getByTestId("count-2")).toHaveText("2", { timeout: 20_000 });
  expect(await counts(ada.page, 3)).toEqual(["1", "0", "2"]);
  await expect(ada.page.getByTestId("voters")).toHaveText("2/2 voted");

  await tab(ada, "Actions");
  await ada.page.getByRole("button", { name: "+ New action" }).click();
  await ada.page.getByTestId("action-title").fill("Picnic");
  await ada.page.getByTestId("action-threshold").fill("2");
  await ada.page.getByRole("button", { name: "Publish" }).click();
  for (const p of [ada, bob]) {
    await tab(p, "Actions");
    await p.page.getByRole("button", { name: "I'm in" }).click();
  }
  await expect(ada.page.getByTestId("pledged")).toHaveText("2/2 committed", { timeout: 20_000 });
  await bob.page.getByRole("button", { name: "Withdraw" }).click();
  await expect(ada.page.getByTestId("pledged")).toHaveText("1/2 committed", { timeout: 20_000 });
  await expect(ada.page.getByText("Threshold not reached yet")).toBeVisible();

  // Zoe asks Ada; Ada sets the request aside.
  await open(zoe, fragment);
  await zoe.page.getByTestId("join-name").fill("Zoe");
  await zoe.page.getByRole("button", { name: "Join", exact: true }).click();
  await zoe.page.getByTestId("ask-member").fill("Ada");
  await zoe.page.getByRole("button", { name: "Send the request" }).click();
  await tab(ada, "Members");
  await expect(ada.page.getByTestId("request")).toBeVisible({ timeout: 20_000 });
  await ada.page.getByRole("button", { name: "Ignore" }).click();
  await expect(ada.page.getByTestId("requests")).toHaveCount(0);

  // Bob leaves (the confirmation is accepted by the test harness).
  await bob.page.getByRole("button", { name: "Leave the group" }).click();
  await expect(bob.page).toHaveURL(/#\/$/);
  await expect(bob.page.getByText("No groups yet.")).toBeVisible();
  await close(ada, bob, zoe);
});

test("a co-organizer signs tickets with an exported organizer key", async ({ browser }) => {
  const ada = await person(browser, "Ada");
  const bob = await person(browser, "Bob");
  const carol = await person(browser, "Carol");
  await open(ada);
  const fragment = await found(ada, "Desk", { tickets: true });
  await joinAndVouch(ada, bob, fragment);

  await tab(ada, "Members");
  await ada.page.getByText("Organizer key").click();
  const key = await text(ada, "organizer-key");
  await tab(bob, "Members");
  await bob.page.getByTestId("organizer-input").fill(key);
  await bob.page.getByRole("button", { name: "Save" }).click();
  await expect(bob.page.getByTestId("ticket-desk")).toBeVisible();

  await open(carol, fragment);
  await carol.page.getByRole("button", { name: "Join", exact: true }).click();
  await carol.page.getByRole("button", { name: "Ask for a ticket" }).click();
  const request = await text(carol, "ticket-request");
  await bob.page.getByTestId("request-input").fill(request);
  await bob.page.getByRole("button", { name: "Sign the ticket" }).click();
  const answer = await text(bob, "ticket-answer-code");
  // Left checked: the admission waits a random delay, and says so.
  await carol.page.getByTestId("ticket-answer").fill(answer);
  await carol.page.getByRole("button", { name: "Use the ticket" }).click();
  await expect(carol.page.getByTestId("admit-scheduled")).toContainText(
    "Valid ticket. Your admission will be published around",
  );
  await close(ada, bob, carol);
});

test("a motion to exclude passes; the excluded member is told and left out", async ({
  browser,
}) => {
  const people = await Promise.all(["Ada", "Bob", "Cat", "Dan"].map((n) => person(browser, n)));
  const [ada, bob, cat, dan] = people as [Person, Person, Person, Person];
  for (const p of people) await p.page.clock.install();
  await open(ada);
  const fragment = await found(ada, "Motion");
  for (const p of [bob, cat, dan]) await joinAndVouch(ada, p, fragment);
  await tab(ada, "Members");
  await expect(ada.page.getByTestId("members").locator(".member")).toHaveCount(4, {
    timeout: 20_000,
  });

  const dansRow = ada.page.getByTestId("members").locator(".member", { hasText: "Dan" });
  await dansRow.getByRole("button", { name: "Propose exclusion" }).click();
  await expect(ada.page.getByTestId("poll-title")).toHaveText("Exclude Dan?");
  for (const p of [ada, bob, cat]) {
    await openPoll(p, "Exclude Dan?");
    await p.page.getByRole("radio", { name: "Yes" }).check();
    await p.page.getByRole("button", { name: "Vote", exact: true }).click();
    await expect(p.page.getByTestId("my-vote")).toHaveText("You voted: Yes");
  }
  await expect(ada.page.getByTestId("count-0")).toHaveText("3", { timeout: 20_000 });

  // Three days later, the motion closes.
  for (const p of people) await p.page.clock.fastForward(73 * 3_600_000);
  await expect(ada.page.getByText("Passed")).toBeVisible({ timeout: 20_000 });
  await tab(ada, "Members");
  await expect(ada.page.getByText("Excluded members")).toBeVisible({ timeout: 20_000 });
  await expect(ada.page.getByTestId("members").locator(".member")).toHaveCount(3);
  await expect(dan.page.getByTestId("excluded")).toBeVisible({ timeout: 30_000 });
  // New polls leave Dan out of the ring.
  await newPoll(bob, "After Dan", ["a", "b"]);
  await openPoll(cat, "After Dan");
  await expect(cat.page.getByText("Possible voters: 3 members")).toBeVisible();
  await close(...people);
});

test("network settings saved, and the group keeps syncing", async ({ browser }) => {
  const ada = await person(browser, "Ada");
  const bob = await person(browser, "Bob");
  await open(ada);
  const fragment = await found(ada, "Settings");
  await joinAndVouch(ada, bob, fragment);
  await ada.page.getByRole("link", { name: "Settings" }).click();
  await ada.page.getByLabel("Nostr relays (one per line)").fill(`ws://${HOST}/relay`);
  await ada.page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(ada.page.getByText("Saved", { exact: true })).toBeVisible();
  await ada.page.getByRole("link", { name: "agora" }).click();
  await ada.page.getByTestId("groups").getByText("Settings").click();
  await newPoll(ada, "Still in sync?", ["yes", "no"]);
  await tab(bob, "Polls");
  await expect(bob.page.getByTestId("polls")).toContainText("Still in sync?", { timeout: 20_000 });
  await close(ada, bob);
});

test("erasing the device from the settings", async ({ browser }) => {
  const ada = await person(browser, "Ada");
  await open(ada);
  await found(ada, "Gone");
  await ada.page.getByRole("link", { name: "Settings" }).click();
  await ada.page.getByRole("button", { name: "Erase everything on this device" }).click();
  await expect(ada.page.getByText("No groups yet.")).toBeVisible();
  await close(ada);
});

test("with no relay at all, members sync peer to peer", async ({ browser }) => {
  const p2p = { relays: [], nostr: false, torrent: true };
  const ada = await person(browser, "Ada", p2p);
  const bob = await person(browser, "Bob", p2p);
  await open(ada);
  const fragment = await found(ada, "Offline-ish");
  await open(bob, fragment);
  await bob.page.getByTestId("join-name").fill("Bob");
  await bob.page.getByRole("button", { name: "Join", exact: true }).click();
  // The group itself arrives over WebRTC (found through the tracker): no relay holds it.
  await expect(bob.page.getByTestId("group-name")).toHaveText("Offline-ish", { timeout: 45_000 });
  await expect(bob.page.getByTestId("status")).toContainText("1 live peer(s)");
  const card = await text(bob, "my-card");
  await ada.page.getByText("Paste their code", { exact: true }).click();
  await ada.page.getByTestId("card-input").fill(card);
  await ada.page.getByRole("button", { name: "Check the card" }).click();
  await ada.page.getByTestId("confirm-vouch").click();
  await admitted(bob);
  await newPoll(bob, "Peer to peer?", ["yes", "no"]);
  await tab(ada, "Polls");
  await expect(ada.page.getByTestId("polls")).toContainText("Peer to peer?", { timeout: 20_000 });
  await close(ada, bob);
});
