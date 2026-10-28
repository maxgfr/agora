import { expect, test } from "bun:test";
import { hashToRoute, type Route, routeToHash } from "./router";

const g = "0123456789abcdef0123456789abcdef";
const p = "fedcba9876543210fedcba9876543210";

test("every route round-trips through its URL", () => {
  const routes: Route[] = [
    { name: "home" },
    { name: "create" },
    { name: "join" },
    { name: "settings" },
    { name: "group", id: g },
    { name: "group", id: g, tab: "actions" },
    { name: "group", id: g, tab: "members" },
    { name: "group", id: g, tab: "polls", item: p },
  ];
  for (const r of routes) expect(hashToRoute(routeToHash(r))).toEqual(r);
  expect(routeToHash({ name: "group", id: g, tab: "polls" })).toBe(`#/g/${g}`);
  // Links from before inviting moved into the members tab still land there.
  expect(hashToRoute(`#/g/${g}/invite`)).toEqual({ name: "group", id: g, tab: "members" });
});

test("anything else is not a route", () => {
  expect(hashToRoute("")).toEqual({ name: "home" });
  for (const h of [
    "#g=abc.def",
    "#/g/xyz",
    `#/g/${g}/nope`,
    `#/g/${g}/actions/${p}`,
    `#/g/${g}/polls/zz`,
    "#/unknown",
  ])
    expect(hashToRoute(h)).toBeNull();
});
