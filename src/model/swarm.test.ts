import { afterAll, expect, test } from "bun:test";
import { FakePC } from "../../test/fake-rtc";
import { serveApp } from "../../test/serve";
import { groupKeys } from "../crypto/seal";
import { randomBytes } from "../lib/bytes";
import { Swarm } from "./swarm";

const server = serveApp({ port: 0, dir: "/nonexistent" });
afterAll(() => server.stop());

test("with only a tracker, two devices meet at once (no hello lost before it connects)", async () => {
  const g = groupKeys(randomBytes(32));
  const config = {
    nostr: { enabled: false, relays: [] },
    torrent: { enabled: true, trackers: [`ws://localhost:${server.port}/tracker`] },
  };
  const peers: Record<string, number> = {};
  const device = (name: string) =>
    new Swarm(
      g,
      {
        have: () => [],
        wire: () => undefined,
        receive: () => {},
        onPeers: (n) => {
          peers[name] = n;
        },
      },
      { config, iceServers: [], rtc: FakePC },
    );
  const a = device("a");
  const b = device("b");
  const started = Date.now();
  while ((peers.a !== 1 || peers.b !== 1) && Date.now() - started < 5000)
    await new Promise((r) => setTimeout(r, 20));
  // Well before the next round of hellos (20 s).
  expect(peers).toEqual({ a: 1, b: 1 });
  a.close();
  b.close();
});
