/**
 * Screens as URLs, in the fragment (GitHub Pages serves one page; the
 * fragment never reaches it):
 *
 *   #/                         home
 *   #/new                      create a group
 *   #/join                     join (paste an invitation)
 *   #/settings
 *   #/g/<group>                a group, on its polls
 *   #/g/<group>/<tab>          actions, members (`invite`, from older links, opens members)
 *   #/g/<group>/polls/<poll>   one poll
 *
 * An invitation (`#g=…`) is not a route: it is read once, kept in memory and
 * replaced in the address bar by `#/join`, so the group secret does not stay
 * in the history.
 */
import type { Invitation } from "../model/codes";

export type GroupTab = "polls" | "actions" | "members";

export type Route =
  | { name: "home" }
  | { name: "create" }
  | { name: "join"; invite?: Invitation }
  | { name: "group"; id: string; tab?: GroupTab; item?: string }
  | { name: "settings" };

const TABS: readonly string[] = ["polls", "actions", "members", "invite"];
const ID = /^[0-9a-f]{32}$/;

export function routeToHash(r: Route): string {
  switch (r.name) {
    case "home":
      return "#/";
    case "create":
      return "#/new";
    case "join":
      return "#/join";
    case "settings":
      return "#/settings";
    case "group": {
      if (r.item) return `#/g/${r.id}/polls/${r.item}`;
      return r.tab && r.tab !== "polls" ? `#/g/${r.id}/${r.tab}` : `#/g/${r.id}`;
    }
  }
}

/** The route a fragment names; null for anything else (an invitation included). */
export function hashToRoute(hash: string): Route | null {
  const path = hash.replace(/^#/, "");
  if (path === "" || path === "/") return { name: "home" };
  if (path === "/new") return { name: "create" };
  if (path === "/join") return { name: "join" };
  if (path === "/settings") return { name: "settings" };
  const parts = path.split("/").slice(1);
  if (parts[0] !== "g" || !ID.test(parts[1] ?? "")) return null;
  const id = parts[1] as string;
  if (parts.length === 2) return { name: "group", id };
  if (!TABS.includes(parts[2] ?? "")) return null;
  // Inviting moved into the members tab.
  const tab = (parts[2] === "invite" ? "members" : parts[2]) as GroupTab;
  if (parts.length === 3) return { name: "group", id, tab };
  if (parts.length === 4 && tab === "polls" && ID.test(parts[3] ?? ""))
    return { name: "group", id, tab, item: parts[3] as string };
  return null;
}
