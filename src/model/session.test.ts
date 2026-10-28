import { afterAll, describe, expect, test } from "bun:test";
import { FakePC } from "../../test/fake-rtc";
import { MemoryBus } from "../../test/memory-transport";
import { serveApp } from "../../test/serve";
import type { SignalConfig } from "../signal/mux";
import { inviteFragment, parseInvite } from "./codes";
import { foundGroup, type GroupRecord, GroupSession, joinRecord, type NetOptions } from "./session";
import { MemoryStore } from "./store";
import { inlineRingCheck } from "./verify";

const server = serveApp({ port: 0, dir: "/nonexistent" });
const relay = `ws://localhost:${server.port}/relay`;
afterAll(() => server.stop());

const relayOnly: SignalConfig = {
  nostr: { enabled: true, relays: [relay] },
  torrent: { enabled: false, trackers: [] },
};

async function until(check: () => boolean, ms = 8000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 20));
  }
}

function device(record: GroupRecord, net: Partial<NetOptions> = {}) {
  const store = new MemoryStore();
  const s = new GroupSession(
    record,
    store,
    { signal: relayOnly, iceServers: [], rtc: FakePC, maintenanceDelay: () => 10, ...net },
    { onRecord: (r) => void r },
  );
  return { s, store };
}

describe("sessions over a relay", () => {
  test("found, vouch, ticket, poll, vote: every device converges", async () => {
    const { record, genesis } = foundGroup({
      name: "Résidence",
      about: "",
      vouches: 1,
      organizer: true,
      memberName: "ada",
    });
    const a = device(record);
    await a.s.start();
    await a.s.publish(genesis);
    const inv = parseInvite(
      `https://x/#${inviteFragment({ secret: Uint8Array.from(Buffer.from(record.secret, "base64url")), genesisId: record.genesisId })}`,
    );
    expect(inv).not.toBeNull();
    if (!inv) return;

    // Bob joins with a vouch: Ada scans his card, his device admits itself.
    const b = device(joinRecord(inv, "bob"));
    await b.s.start();
    await until(() => b.s.view.value?.genesis?.name === "Résidence");
    await a.s.vouch(b.s.me.card);
    await until(() => !!b.s.view.value?.me);
    expect(b.s.view.value?.members.map((m) => m.name)).toEqual(["ada", "bob"]);

    // Carol joins with a blind ticket, anonymously.
    const c = device(joinRecord(inv));
    await c.s.start();
    await until(() => !!c.s.view.value?.policy);
    const issuer = c.s.view.value?.policy?.issuers[0] as string;
    const request = c.s.requestTicket(issuer);
    const answer = a.s.signTicket(request);
    await c.s.acceptTicket(answer, 0);
    await until(() => !!c.s.view.value?.me && a.s.view.value?.members.length === 3);
    expect(a.s.view.value?.members.map((m) => m.via)).toEqual(["founder", "vouch", "ticket"]);
    expect(a.s.record.organizer?.[0]?.served).toBe(1);

    // A poll: everyone votes; Bob changes his mind.
    await until(() => b.s.view.value?.members.length === 3);
    const pid = await b.s.createPoll({
      q: "Repeindre le hall ?",
      options: ["oui", "non"],
      multi: false,
      closes: Date.now() + 3_600_000,
    });
    await until(() => [a, c].every((d) => d.s.view.value?.polls.length === 1));
    await a.s.vote(pid, [0]);
    await b.s.vote(pid, [0]);
    await c.s.vote(pid, [1]);
    await b.s.vote(pid, [1]);
    const done = (d: typeof a) => d.s.view.value?.polls[0]?.counts.join() === "1,2";
    await until(() => [a, b, c].every(done));
    expect(b.s.view.value?.polls[0]?.mine?.choice).toEqual([1]);
    expect(c.s.view.value?.polls[0]?.mine?.choice).toEqual([1]);

    // The relay only ever saw ciphertext under a random-looking tag.
    for (const ev of server.relay.seen) {
      expect(ev.content).not.toContain("Repeindre");
      expect(ev.content).not.toContain("bob");
    }
    for (const d of [a, b, c]) d.s.close();
  }, 30_000);

  test("exclusion, then a new key the excluded member cannot read", async () => {
    const { record, genesis } = foundGroup({
      name: "G",
      about: "",
      vouches: 1,
      organizer: false,
      memberName: "a",
    });
    const a = device(record);
    await a.s.start();
    await a.s.publish(genesis);
    const inv = {
      secret: Uint8Array.from(Buffer.from(record.secret, "base64url")),
      genesisId: record.genesisId,
    };
    const others = ["b", "c", "x"].map((n) => device(joinRecord(inv, n)));
    for (const d of others) {
      await d.s.start();
      await until(() => !!d.s.view.value?.genesis);
      await a.s.vouch(d.s.me.card);
      await until(() => !!d.s.view.value?.me);
    }
    const [b, c, x] = others as [typeof a, typeof a, typeof a];
    await until(() => [a, b, c, x].every((d) => d.s.view.value?.members.length === 4));
    const closes = Date.now() + 1500;
    const mid = await a.s.createPoll({
      q: "Exclude x?",
      options: ["yes", "no"],
      multi: false,
      closes,
      exclude: x.s.me.card.key,
    });
    await until(() => [b, c].every((d) => d.s.view.value?.polls.length === 1));
    await a.s.vote(mid, [0]);
    await b.s.vote(mid, [0]);
    await c.s.vote(mid, [0]);
    await new Promise((r) => setTimeout(r, closes - Date.now() + 100));
    // Something new makes everyone fold again after the deadline.
    await b.s.createAction({
      title: "after",
      details: "",
      threshold: 1,
      closes: Date.now() + 60_000,
    });
    await until(() => a.s.view.value?.members.length === 3);
    // Someone rekeys (maintenance; several may, harmlessly), and new content uses a new key.
    await until(() =>
      [a, b, c].every((d) => !d.s.view.value?.needsRekey && (d.s.view.value?.keys.size ?? 0) >= 2),
    );
    await c.s.createAction({
      title: "secret plan",
      details: "",
      threshold: 1,
      closes: Date.now() + 60_000,
    });
    await until(
      () => a.s.view.value?.actions.some((x) => x.action.title === "secret plan") ?? false,
    );
    await new Promise((r) => setTimeout(r, 300));
    expect(x.s.view.value?.actions.some((y) => y.action.title === "secret plan")).toBe(false);
    expect(x.s.view.value?.me).toBeUndefined();
    for (const d of [a, b, c, x]) d.s.close();
  }, 30_000);
});

test("peers sync over WebRTC without any relay", async () => {
  const bus = new MemoryBus();
  // No relay for the log: only the swarm (signaling on an in-memory bus, fake WebRTC).
  const p2p = (): Partial<NetOptions> => ({
    signal: { nostr: { enabled: false, relays: [] }, torrent: { enabled: false, trackers: [] } },
    factory: bus.factory(),
    rtc: FakePC,
  });
  const { record, genesis } = foundGroup({
    name: "P2P",
    about: "",
    vouches: 1,
    organizer: false,
    memberName: "a",
  });
  const a = device(record, p2p());
  await a.s.start();
  await a.s.publish(genesis);
  const inv = {
    secret: Uint8Array.from(Buffer.from(record.secret, "base64url")),
    genesisId: record.genesisId,
  };
  const b = device(joinRecord(inv, "b"), p2p());
  await b.s.start();
  await until(() => b.s.view.value?.genesis?.name === "P2P", 10_000);
  await a.s.vouch(b.s.me.card);
  await until(() => a.s.view.value?.members.length === 2, 10_000);
  expect(a.s.peers.value).toBe(1);
  a.s.close();
  b.s.close();
}, 20_000);

test("our own vote shows at once, even behind a backlog of signatures to check", async () => {
  const { record, genesis } = foundGroup({
    name: "Slow",
    about: "",
    vouches: 1,
    organizer: false,
    memberName: "a",
  });
  // A slow checker: 150 ms per ring signature, like a large group on a phone.
  const slow: NetOptions["ringCheck"] = async (job) => {
    await new Promise((r) => setTimeout(r, 150));
    return inlineRingCheck(job);
  };
  const a = device(record, { offline: true });
  await a.s.start();
  await a.s.publish(genesis);
  const inv = {
    secret: Uint8Array.from(Buffer.from(record.secret, "base64url")),
    genesisId: record.genesisId,
  };
  const b = device(joinRecord(inv, "b"), { offline: true });
  await b.s.start();
  // Copy a's log to b by hand (offline), then let b in.
  const sync = async (from: typeof a, to: typeof a) => {
    for (const w of await from.store.wires(from.s.record.id)) await to.s.ingest(w, true);
  };
  await sync(a, b);
  await a.s.vouch(b.s.me.card);
  await sync(a, b);
  await until(() => !!b.s.view.value?.me);
  await sync(b, a);
  await until(() => a.s.view.value?.members.length === 2);
  const polls: string[] = [];
  for (let i = 0; i < 8; i++)
    polls.push(
      await a.s.createPoll({
        q: `Q${i}`,
        options: ["x", "y"],
        multi: false,
        closes: Date.now() + 3_600_000,
      }),
    );
  // c is a fresh device of b's: same member, empty verdict cache, slow checks.
  const c = device(b.s.record, { offline: true, ringCheck: slow });
  await c.s.start();
  await sync(a, c);
  await until(() => !!c.s.verifying.value);
  const started = Date.now();
  await until(() => (c.s.view.value?.polls.length ?? 0) > 0, 3000);
  await c.s.vote(c.s.view.value?.polls[0]?.id as string, [0]);
  // Shown well before the backlog (8 polls × 150 ms) is through.
  expect(c.s.view.value?.polls.find((p) => p.mine)).toBeDefined();
  expect(Date.now() - started).toBeLessThan(1000);
  expect(c.s.verifying.value).not.toBeNull();
  for (const d of [a, b, c]) d.s.close();
}, 20_000);
