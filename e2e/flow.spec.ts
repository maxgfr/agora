import { expect, test } from "@playwright/test";
import { close, found, open, type Person, person, tab, text } from "./helpers";

/** Waits until a person is a member (the group tabs show). */
async function admitted(p: Person): Promise<void> {
  await expect(p.page.getByRole("navigation").getByRole("link", { name: "Polls" })).toBeVisible({
    timeout: 30_000,
  });
}

async function openPoll(p: Person, title: string): Promise<void> {
  await tab(p, "Polls");
  await p.page.getByTestId("polls").getByText(title).click();
  await expect(p.page.getByTestId("poll-title")).toHaveText(title);
}

async function counts(p: Person, expected: number[]): Promise<void> {
  for (let i = 0; i < expected.length; i++)
    await expect(p.page.getByTestId(`count-${i}`)).toHaveText(String(expected[i]), {
      timeout: 30_000,
    });
}

test("a group: vouching, a blind ticket, a poll, a changed vote and an action", async ({
  browser,
}) => {
  const ada = await person(browser, "ada");
  const bob = await person(browser, "bob");
  const carol = await person(browser, "carol");

  // Ada founds the group: vouching (1) and organizer tickets.
  await open(ada);
  const fragment = await found(ada, "Building 12", { tickets: true });

  // Bob opens the link and shows his card; Ada vouches for him.
  await open(bob, fragment);
  await bob.page.getByTestId("join-name").fill("bob");
  await bob.page.getByRole("button", { name: "Join", exact: true }).click();
  await expect(bob.page.getByTestId("group-name")).toHaveText("Building 12");
  const card = await text(bob, "my-card");
  await tab(ada, "Members");
  await ada.page.getByText("Paste their code", { exact: true }).click();
  await ada.page.getByTestId("card-input").fill(card);
  await ada.page.getByRole("button", { name: "Check the card" }).click();
  await expect(ada.page.locator(".person-name")).toHaveText("bob");
  await ada.page.getByTestId("confirm-vouch").click();
  await expect(ada.page.getByTestId("vouched")).toBeVisible();
  await admitted(bob);
  await expect(ada.page.getByTestId("members").locator(".member")).toHaveCount(2);

  // Carol gets an entry password from Ada, the organizer, and types it.
  await tab(ada, "Members");
  await ada.page.getByTestId("make-passwords").click();
  const password = await text(ada, "password");
  await expect(ada.page.getByTestId("passwords")).toContainText("0 used of 1");
  await open(carol, fragment);
  await carol.page.getByRole("button", { name: "Join", exact: true }).click();
  await carol.page.getByTestId("delay-admit").uncheck();
  await carol.page.getByTestId("entry-password").fill(password.toLowerCase());
  await carol.page.getByRole("button", { name: "Join", exact: true }).click();
  await admitted(carol);
  await expect(ada.page.getByTestId("passwords")).toContainText("1 used of 1", {
    timeout: 20_000,
  });
  await tab(carol, "Members");
  await expect(carol.page.getByTestId("members").locator(".member")).toHaveCount(3);
  await expect(carol.page.getByText("joined with a ticket")).toBeVisible();

  // Bob asks a question; everyone votes.
  await tab(bob, "Members");
  await expect(bob.page.getByTestId("members").locator(".member")).toHaveCount(3);
  await tab(bob, "Polls");
  await bob.page.getByRole("button", { name: "+ New poll" }).click();
  await bob.page.getByTestId("poll-q").fill("Paint the hall?");
  await bob.page.getByTestId("poll-option-0").fill("Yes");
  await bob.page.getByTestId("poll-option-1").fill("No");
  await bob.page.getByRole("button", { name: "Publish" }).click();

  const votes: [Person, string][] = [
    [ada, "Yes"],
    [bob, "No"],
    [carol, "No"],
  ];
  for (const [p, choice] of votes) {
    await openPoll(p, "Paint the hall?");
    await p.page.getByRole("radio", { name: choice }).check();
    await p.page.getByRole("button", { name: "Vote", exact: true }).click();
    await expect(p.page.getByTestId("my-vote")).toHaveText(`You voted: ${choice}`);
  }
  for (const p of [ada, bob, carol]) await counts(p, [1, 2]);

  // Bob changes his mind: his vote is replaced, not added.
  await bob.page.getByRole("button", { name: "Change my vote" }).click();
  await bob.page.getByRole("radio", { name: "Yes" }).check();
  await bob.page.getByRole("button", { name: "Vote", exact: true }).click();
  for (const p of [ada, bob, carol]) {
    await counts(p, [2, 1]);
    await expect(p.page.getByTestId("voters")).toHaveText("3/3 voted");
  }

  // An action that happens once two members commit.
  await tab(ada, "Actions");
  await ada.page.getByRole("button", { name: "+ New action" }).click();
  await ada.page.getByTestId("action-title").fill("Repaint on Saturday");
  await ada.page.getByTestId("action-threshold").fill("2");
  await ada.page.getByRole("button", { name: "Publish" }).click();
  for (const p of [bob, carol]) {
    await tab(p, "Actions");
    await p.page.getByRole("button", { name: "I'm in" }).click();
    await expect(p.page.getByText("You are committed.")).toBeVisible();
  }
  await expect(ada.page.getByTestId("pledged")).toHaveText("2/2 committed", { timeout: 30_000 });
  await expect(ada.page.getByText("Threshold reached: the action is on")).toBeVisible();

  await close(ada, bob, carol);
});

test("a reload keeps the group", async ({ browser }) => {
  const ada = await person(browser, "ada");
  await open(ada);
  await found(ada, "Secret club");
  await open(ada);
  await expect(ada.page.getByTestId("groups")).toContainText("Secret club");
  await ada.page.getByTestId("groups").getByText("Secret club").click();
  await admitted(ada);
  await close(ada);
});
