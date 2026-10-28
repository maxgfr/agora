import { expect, test } from "@playwright/test";
import { close, found, open, type Person, person, tab, text } from "./helpers";

async function admitted(p: Person): Promise<void> {
  await expect(p.page.getByRole("navigation").getByRole("link", { name: "Polls" })).toBeVisible({
    timeout: 30_000,
  });
}

async function join(p: Person, fragment: string, name = ""): Promise<void> {
  await open(p, fragment);
  if (name) await p.page.getByTestId("join-name").fill(name);
  await p.page.getByRole("button", { name: "Join", exact: true }).click();
  await expect(p.page.getByTestId("group-name")).toBeVisible();
}

/** Pastes a code into the app-wide scanner (the camera path ends in the same place). */
async function scan(p: Person, code: string): Promise<void> {
  await p.page.getByTestId("scan").click();
  await expect(p.page.getByRole("dialog", { name: "Scan a code" })).toBeVisible();
  await p.page.getByTestId("scan-input").fill(code);
  await p.page.getByRole("button", { name: "Open", exact: true }).click();
  await expect(p.page.getByRole("dialog")).toBeHidden();
}

test("a newcomer asks a member by name; the member vouches from the pending request", async ({
  browser,
}) => {
  const ada = await person(browser, "Ada");
  const bob = await person(browser, "Bob");
  await open(ada);
  const fragment = await found(ada, "Club");
  await join(bob, fragment, "Bob");
  // No list of members is shown: Bob types the name himself.
  await expect(bob.page.getByTestId("members")).toHaveCount(0);
  // A name nobody has reads as sent too: the form never tells who is in the group.
  await bob.page.getByTestId("ask-member").fill("Zed");
  await bob.page.getByRole("button", { name: "Send the request" }).click();
  await expect(bob.page.getByTestId("asked")).toHaveText("Request sent to Zed · pending");
  await expect(bob.page.getByRole("alert")).toHaveCount(0);
  await bob.page.getByTestId("ask-member").fill("ada");
  await bob.page.getByRole("button", { name: "Send the request" }).click();
  await expect(bob.page.getByTestId("asked").locator("li")).toHaveText([
    "Request sent to Zed · pending",
    "Request sent to ada · pending",
  ]);

  // Ada is told wherever she is in the group, and vouches in one tap from the members tab.
  await tab(ada, "Polls");
  await expect(ada.page.getByText("1 pending vouch request(s) →")).toBeVisible({ timeout: 30_000 });
  await ada.page.getByText("1 pending vouch request(s) →").click();
  await expect(ada.page).toHaveURL(/\/members$/);
  const request = ada.page.getByTestId("request");
  await expect(request.locator(".person-name")).toHaveText("Bob");
  // The emojis match on both screens.
  const emojis = await request.locator(".fingerprint").textContent();
  await expect(bob.page.locator(".fingerprint").first()).toHaveText(emojis ?? "");
  await request.getByRole("button", { name: "Vouch for Bob" }).click();
  await expect(ada.page.getByTestId("requests")).toHaveCount(0);
  await admitted(bob);
  await tab(bob, "Members");
  await expect(bob.page.getByTestId("members").locator(".member")).toHaveCount(2);
  await close(ada, bob);
});

test("the app-wide scanner opens invitations, cards and ticket codes", async ({ browser }) => {
  const ada = await person(browser, "Ada");
  const carol = await person(browser, "Carol");
  const dan = await person(browser, "Dan");
  await open(ada);
  const fragment = await found(ada, "Desk", { tickets: true });
  const link = await text(ada, "invite-link");

  // An invitation link, scanned, opens the join screen.
  await open(carol);
  await scan(carol, link);
  await expect(carol.page).toHaveURL(/#\/join$/);
  await carol.page.getByTestId("join-name").fill("Carol");
  await carol.page.getByRole("button", { name: "Join", exact: true }).click();

  // Carol's card, scanned by Ada from anywhere, lands on the vouch confirmation.
  const card = await text(carol, "my-card");
  await ada.page.getByRole("link", { name: "agora" }).click();
  await scan(ada, card);
  await expect(ada.page).toHaveURL(/\/members$/);
  await expect(ada.page.locator(".person-name")).toHaveText("Carol");
  await ada.page.getByTestId("confirm-vouch").click();
  await admitted(carol);

  // Dan uses a ticket: his request goes to Ada's desk, her answer back to him.
  await join(dan, fragment);
  await dan.page.getByRole("button", { name: "Ask for a ticket" }).click();
  const request = await text(dan, "ticket-request");
  await scan(ada, request);
  await expect(ada.page).toHaveURL(/\/members$/);
  await expect(ada.page.getByTestId("request-input")).toHaveValue(request);
  await ada.page.getByRole("button", { name: "Sign the ticket" }).click();
  const answer = await text(ada, "ticket-answer-code");
  await dan.page.getByTestId("delay-admit").uncheck();
  await scan(dan, answer);
  await expect(dan.page.getByTestId("ticket-answer")).toHaveValue(answer);
  await dan.page.getByRole("button", { name: "Use the ticket" }).click();
  await admitted(dan);

  // Codes the scanner cannot place say why.
  await dan.page.getByTestId("scan").click();
  await dan.page.getByTestId("scan-input").fill("hello");
  await dan.page.getByRole("button", { name: "Open", exact: true }).click();
  await expect(dan.page.getByRole("dialog").getByRole("alert")).toHaveText(
    "This is not an agora code.",
  );
  await dan.page.keyboard.press("Escape");
  await expect(dan.page.getByRole("dialog")).toBeHidden();
  await close(ada, carol, dan);
});
