import { expect, test } from "@playwright/test";
import { BASE, close, found, open, person, tab } from "./helpers";

const GROUP_URL = /#\/g\/[0-9a-f]{32}$/;

test("every screen has its own URL; back, forward and reload follow it", async ({ browser }) => {
  const ada = await person(browser, "ada");
  const { page } = ada;
  await open(ada);

  await page.getByRole("link", { name: "Create a group" }).click();
  await expect(page).toHaveURL(/#\/new$/);
  await page.getByRole("link", { name: "← Back" }).click();
  await expect(page).toHaveURL(/#\/$/);
  await page.goBack();
  await expect(page).toHaveURL(/#\/new$/);
  await expect(page.getByRole("heading", { name: "Create a group" })).toBeVisible();
  await page.goForward();
  await expect(
    page.getByRole("heading", { name: "Decide together, without saying who voted what." }),
  ).toBeVisible();

  await found(ada, "Club");
  // The creation form is replaced in the history: back from the group goes home.
  await expect(page).toHaveURL(/#\/g\/[0-9a-f]{32}\/members$/);
  await expect(page).toHaveTitle("Club · agora");
  const groupHash = new URL(page.url()).hash.replace(/\/members$/, "");

  await tab(ada, "Members");
  await expect(page).toHaveURL(/\/members$/);
  await tab(ada, "Polls");
  await expect(page).toHaveURL(GROUP_URL);
  await page.getByRole("button", { name: "+ New poll" }).click();
  await page.getByTestId("poll-q").fill("Lunch?");
  await page.getByTestId("poll-option-0").fill("Pizza");
  await page.getByTestId("poll-option-1").fill("Salad");
  await page.getByRole("button", { name: "Publish" }).click();
  await page.getByTestId("polls").getByText("Lunch?").click();
  await expect(page).toHaveURL(/\/polls\/[0-9a-f]{32}$/);
  const pollUrl = page.url();

  // A reload lands on the same poll.
  await page.reload();
  await expect(page.getByTestId("poll-title")).toHaveText("Lunch?");
  // Back returns to the list, then to the members tab.
  await page.goBack();
  await expect(page).toHaveURL(GROUP_URL);
  await expect(page.getByTestId("polls")).toContainText("Lunch?");
  await page.goBack();
  await expect(page).toHaveURL(/\/members$/);
  await expect(page.getByTestId("members")).toBeVisible();

  // Deep links open directly (a full load: the query differs).
  await page.goto(`${BASE}/?nosw&fresh${pollUrl.slice(pollUrl.indexOf("#"))}`);
  await expect(page.getByTestId("poll-title")).toHaveText("Lunch?");
  await page.getByRole("link", { name: "agora" }).click();
  await expect(page).toHaveURL(/#\/$/);
  await page.getByTestId("groups").getByText("Club").click();
  expect(new URL(page.url()).hash).toBe(groupHash);

  // Unknown groups and unknown paths.
  await page.goto(`${BASE}/?nosw#/g/${"0".repeat(32)}`);
  await expect(page.getByRole("heading", { name: "Group not found" })).toBeVisible();
  await page.goto(`${BASE}/?nosw#/nowhere`);
  await expect(page).toHaveURL(/#\/$/);
  await close(ada);
});

test("an invitation leaves the address bar at once", async ({ browser }) => {
  const ada = await person(browser, "ada");
  const bob = await person(browser, "bob");
  await open(ada);
  const fragment = await found(ada, "Club");
  await open(bob, fragment);
  await expect(bob.page).toHaveURL(/#\/join$/);
  expect(bob.page.url()).not.toContain("g=");
  await bob.page.getByRole("button", { name: "Join", exact: true }).click();
  await expect(bob.page).toHaveURL(GROUP_URL);
  // Back from the group does not return to the used-up join form.
  await bob.page.goBack();
  await expect(bob.page).not.toHaveURL(/#\/join$/);
  // The founder opening their own invitation goes straight to the group.
  await open(ada, fragment);
  await expect(ada.page).toHaveURL(GROUP_URL);
  await close(ada, bob);
});

test("the tab in front is the active one; an inactive tab takes over when looked at", async ({
  browser,
}) => {
  const ada = await person(browser, "ada");
  await open(ada);
  await found(ada, "Club");
  const elsewhere = "agora is open in another tab";
  // A tab opened in front (say, from a link) takes over at once.
  const second = await ada.ctx.newPage();
  await second.goto(`${BASE}/?nosw`);
  await expect(second.getByTestId("groups")).toContainText("Club");
  await expect(ada.page.getByRole("heading", { name: elsewhere })).toBeVisible();
  // Back to the first tab: it takes over again by itself, no button to press.
  await ada.page.bringToFront();
  await ada.page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(ada.page.getByTestId("group-name")).toHaveText("Club");
  await expect(second.getByRole("heading", { name: elsewhere })).toBeVisible();
  // The button still works where focus cannot be told.
  await second.getByRole("button", { name: "Use this tab" }).click();
  await expect(second.getByTestId("groups")).toContainText("Club");
  await close(ada);
});

test("links to the old invite tab open the members tab", async ({ browser }) => {
  const ada = await person(browser, "ada");
  await open(ada);
  await found(ada, "Club");
  const hash = new URL(ada.page.url()).hash.replace(/\/members$/, "/invite");
  await ada.page.goto(`${BASE}/?nosw&old${hash}`);
  await expect(ada.page).toHaveURL(/\/members$/);
  await expect(ada.page.getByTestId("add-people")).toBeVisible();
  await expect(ada.page.getByRole("navigation").getByRole("link")).toHaveText([
    "Polls",
    "Actions",
    "Members",
  ]);
  await close(ada);
});
