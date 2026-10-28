import { expect, test } from "@playwright/test";
import { close, found, open, person, tab, text } from "./helpers";

test("a signature checker that never answers does not freeze the group", async ({ browser }) => {
  const ada = await person(browser, "Ada");
  const bob = await person(browser, "Bob");
  // Bob's verification worker loads but never replies (as when a browser kills it).
  await bob.ctx.route(/\/assets\/verify-[^/]+\.js$/, (route) =>
    route.fulfill({ contentType: "text/javascript", body: "self.onmessage = () => {};" }),
  );
  await open(ada);
  const fragment = await found(ada, "Club");
  await open(bob, fragment);
  await bob.page.getByTestId("join-name").fill("Bob");
  await bob.page.getByRole("button", { name: "Join", exact: true }).click();
  const card = await text(bob, "my-card");
  await tab(ada, "Members");
  await ada.page.getByText("Paste their code", { exact: true }).click();
  await ada.page.getByTestId("card-input").fill(card);
  await ada.page.getByRole("button", { name: "Check the card" }).click();
  await ada.page.getByTestId("confirm-vouch").click();
  await expect(bob.page.getByRole("navigation").getByRole("link", { name: "Polls" })).toBeVisible();

  // Ada's poll needs a ring check on Bob's side: it still shows, once the deadline passes.
  await tab(ada, "Polls");
  await ada.page.getByRole("button", { name: "+ New poll" }).click();
  await ada.page.getByTestId("poll-q").fill("Still alive?");
  await ada.page.getByTestId("poll-option-0").fill("Yes");
  await ada.page.getByTestId("poll-option-1").fill("No");
  await ada.page.getByRole("button", { name: "Publish" }).click();
  await expect(bob.page.getByTestId("polls")).toContainText("Still alive?", { timeout: 20_000 });

  // And the next check runs on a fresh worker or here: Bob votes, Ada sees it.
  await bob.page.getByTestId("polls").getByText("Still alive?").click();
  await bob.page.getByRole("radio", { name: "Yes" }).check();
  await bob.page.getByRole("button", { name: "Vote", exact: true }).click();
  await expect(bob.page.getByTestId("my-vote")).toHaveText("You voted: Yes");
  await ada.page.getByTestId("polls").getByText("Still alive?").click();
  await expect(ada.page.getByTestId("count-0")).toHaveText("1", { timeout: 20_000 });

  // The diagnostics say what happened.
  await bob.page.getByRole("link", { name: "Settings" }).click();
  await expect(bob.page.getByTestId("diagnostics")).toContainText("Signature checker restarts: 1");
  await close(ada, bob);
});

test("joining while no relay answers says so, instead of a silent spinner", async ({ browser }) => {
  const ada = await person(browser, "Ada");
  await open(ada);
  const fragment = await found(ada, "Unreachable");
  // Bob's relays are all down (nothing listens there) and nobody is online for him.
  const bob = await person(browser, "Bob", { relays: ["ws://localhost:9/none"], torrent: false });
  await open(bob, fragment);
  await bob.page.getByRole("button", { name: "Join", exact: true }).click();
  const searching = bob.page.getByTestId("searching");
  await expect(searching).toContainText("Relays answering: 0/1");
  await expect(searching).toContainText("Still nothing?", { timeout: 15_000 });
  await close(ada, bob);
});
