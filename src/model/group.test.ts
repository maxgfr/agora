import { describe, expect, test } from "bun:test";
import { newIssuer, signBlinded, unblind } from "../crypto/blind";
import { groupKeys, keyId } from "../crypto/seal";
import { randomBytes, toB64u } from "../lib/bytes";
import {
  createAction,
  createAdmit,
  createGenesis,
  createKeyEvent,
  createPledge,
  createPoll,
  createVote,
  type Me,
  newMe,
  ticketRequest,
  vouchFor,
} from "./author";
import { type AgoraEvent, eventId, type Policy, type Poll } from "./events";
import { currentRing, fold } from "./group";
import { Verifier } from "./verify";

const HOUR = 3_600_000;

/** A group in memory: events, verification, fold. */
function world(policy: Policy, t0 = 1_000_000) {
  const g = groupKeys(randomBytes(32));
  const founder = newMe("ada");
  const events = new Map<string, AgoraEvent>();
  const add = (ev: AgoraEvent) => {
    const id = eventId(ev);
    events.set(id, ev);
    return id;
  };
  const genesisId = add(createGenesis(g, founder, { name: "Club", about: "", policy }, t0));
  const view = async (me: Me = founder, now = t0 + 10 * HOUR) => {
    const valid = await new Verifier(g.groupId).run(events);
    return fold(g, genesisId, events, valid, me, now);
  };
  return { g, founder, events, add, view, genesisId };
}

describe("admission", () => {
  test("vouching: k vouches, capped by the roster size", async () => {
    const w = world({ vouches: 2, issuers: [] });
    const bob = newMe("bob");
    // One member so far: one vouch is enough.
    w.add(createAdmit(w.g, bob, { vouches: [vouchFor(w.g, w.founder, bob.card)] }, 2_000_000));
    expect((await w.view()).members.map((m) => m.name)).toEqual(["ada", "bob"]);
    // Two members now: carol needs both.
    const carol = newMe("carol");
    w.add(createAdmit(w.g, carol, { vouches: [vouchFor(w.g, w.founder, carol.card)] }, 3_000_000));
    expect((await w.view()).members).toHaveLength(2);
    const dan = newMe("dan");
    w.add(
      createAdmit(
        w.g,
        dan,
        { vouches: [vouchFor(w.g, w.founder, dan.card), vouchFor(w.g, bob, dan.card)] },
        4_000_000,
      ),
    );
    const v = await w.view();
    expect(v.members.map((m) => m.name)).toEqual(["ada", "bob", "dan"]);
    expect(v.members[2]?.vouchedBy.sort()).toEqual([w.founder.card.key, bob.card.key].sort());
  });

  test("a vouch from an outsider, or a forged one, does not count", async () => {
    const w = world({ vouches: 1, issuers: [] });
    const eve = newMe("eve");
    const mallory = newMe("mallory");
    w.add(createAdmit(w.g, mallory, { vouches: [vouchFor(w.g, eve, mallory.card)] }, 2_000_000));
    // A vouch signed for someone else's card.
    const bob = newMe("bob");
    const stolen = vouchFor(w.g, w.founder, bob.card);
    w.add(createAdmit(w.g, newMe("bob"), { vouches: [stolen] }, 2_100_000));
    expect((await w.view()).members).toHaveLength(1);
  });

  test("blind tickets admit anonymously; another organizer's do not", async () => {
    const org = newIssuer();
    const w = world({ vouches: 0, issuers: [toB64u(org.pub)] });
    const anon = newMe();
    const req = ticketRequest(w.g, anon);
    const sig = unblind(
      signBlinded(org.secret, req.request),
      req.factor,
      w.g.groupId,
      anon.sign.pub,
      org.pub,
    );
    w.add(
      createAdmit(
        w.g,
        anon,
        { vouches: [], ticket: { issuer: toB64u(org.pub), sig: toB64u(sig) } },
        2_000_000,
      ),
    );
    const rogue = newIssuer();
    const other = newMe();
    const req2 = ticketRequest(w.g, other);
    const sig2 = unblind(
      signBlinded(rogue.secret, req2.request),
      req2.factor,
      w.g.groupId,
      other.sign.pub,
      rogue.pub,
    );
    w.add(
      createAdmit(
        w.g,
        other,
        { vouches: [], ticket: { issuer: toB64u(rogue.pub), sig: toB64u(sig2) } },
        2_100_000,
      ),
    );
    const v = await w.view();
    expect(v.members).toHaveLength(2);
    expect(v.members[1]?.via).toBe("ticket");
    expect(v.members[1]?.name).toBeUndefined();
  });

  test("vouching off: vouches alone do not admit", async () => {
    const org = newIssuer();
    const w = world({ vouches: 0, issuers: [toB64u(org.pub)] });
    const bob = newMe("bob");
    w.add(createAdmit(w.g, bob, { vouches: [vouchFor(w.g, w.founder, bob.card)] }, 2_000_000));
    expect((await w.view()).members).toHaveLength(1);
  });
});

/** A group of `n` members (founder first), all admitted by the founder. */
async function club(n: number) {
  const w = world({ vouches: 1, issuers: [] });
  const people = [w.founder];
  for (let i = 1; i < n; i++) {
    const p = newMe(`m${i}`);
    w.add(createAdmit(w.g, p, { vouches: [vouchFor(w.g, w.founder, p.card)] }, 1_000_000 + i));
    people.push(p);
  }
  const ring = currentRing(await w.view());
  return { ...w, people, ring };
}

describe("polls", () => {
  test("one member, one vote; the last vote of a member counts", async () => {
    const c = await club(4);
    const [a, b, d] = c.people as [Me, Me, Me, Me];
    const opts = { q: "Pizza?", options: ["yes", "no"], multi: false, closes: 5 * HOUR };
    const poll = createPoll(c.g, b, c.ring, opts, 2 * HOUR);
    const pid = c.add(poll);
    c.add(createVote(c.g, a, poll, pid, [0], 0, 3 * HOUR));
    c.add(createVote(c.g, b, poll, pid, [0], 0, 3 * HOUR));
    // b changes their mind, and a's duplicate does not count twice.
    c.add(createVote(c.g, b, poll, pid, [1], 1, 3 * HOUR + 1));
    c.add(createVote(c.g, a, poll, pid, [0], 0, 3 * HOUR + 2));
    c.add(createVote(c.g, d, poll, pid, [1], 0, 3 * HOUR));
    const v = await c.view(b);
    const pv = v.polls[0];
    expect(pv?.counts).toEqual([1, 2]);
    expect(pv?.voters).toBe(3);
    expect(pv?.mine).toEqual({ choice: [1], seq: 1 });
    // Every device counts the same.
    expect((await c.view(a)).polls[0]?.counts).toEqual([1, 2]);
  });

  test("votes after closing, from outside the ring, or for a bad option are ignored", async () => {
    const c = await club(3);
    const [a, b] = c.people as [Me, Me, Me];
    const poll = createPoll(
      c.g,
      a,
      c.ring,
      { q: "?", options: ["x", "y"], multi: false, closes: 5 * HOUR },
      2 * HOUR,
    );
    const pid = c.add(poll);
    c.add(createVote(c.g, a, poll, pid, [0], 0, 6 * HOUR));
    const outsider = newMe("o");
    const fake: Poll = { ...poll, ring: [...poll.ring, outsider.card.key].sort() };
    c.add(createVote(c.g, outsider, fake, pid, [1], 0, 3 * HOUR));
    const bad = createVote(c.g, b, poll, pid, [0], 0, 3 * HOUR);
    c.add({ ...bad, choice: [5] });
    const pv = (await c.view()).polls[0];
    expect(pv?.voters).toBe(0);
  });

  test("a poll whose ring holds a non-member is dropped", async () => {
    const c = await club(2);
    const sybil = newMe("sybil");
    const ring = [...c.ring, sybil.card.key].sort();
    c.add(
      createPoll(
        c.g,
        sybil,
        ring,
        { q: "?", options: ["x", "y"], multi: false, closes: 5 * HOUR },
        2 * HOUR,
      ),
    );
    expect((await c.view()).polls).toHaveLength(0);
  });

  test("multiple choice", async () => {
    const c = await club(2);
    const [a, b] = c.people as [Me, Me];
    const poll = createPoll(
      c.g,
      a,
      c.ring,
      { q: "When?", options: ["mon", "tue", "wed"], multi: true, closes: 5 * HOUR },
      2 * HOUR,
    );
    const pid = c.add(poll);
    c.add(createVote(c.g, a, poll, pid, [0, 2], 0, 3 * HOUR));
    c.add(createVote(c.g, b, poll, pid, [2], 0, 3 * HOUR));
    expect((await c.view()).polls[0]?.counts).toEqual([1, 0, 2]);
  });
});

describe("actions", () => {
  test("an action is on once enough members pledge; withdrawals count", async () => {
    const c = await club(4);
    const [a, b, d] = c.people as [Me, Me, Me, Me];
    const action = createAction(
      c.g,
      a,
      c.ring,
      { title: "Strike", details: "", threshold: 2, closes: 9 * HOUR },
      2 * HOUR,
    );
    const id = c.add(action);
    c.add(createPledge(c.g, a, action, id, true, 0, 3 * HOUR));
    expect((await c.view()).actions[0]?.reached).toBe(false);
    c.add(createPledge(c.g, b, action, id, true, 0, 3 * HOUR));
    expect((await c.view()).actions[0]?.reached).toBe(true);
    c.add(createPledge(c.g, b, action, id, false, 1, 4 * HOUR));
    c.add(createPledge(c.g, d, action, id, true, 0, 4 * HOUR));
    const av = (await c.view(b)).actions[0];
    expect(av?.pledged).toBe(2);
    expect(av?.mine).toEqual({ on: false, seq: 1 });
  });
});

describe("exclusion and keys", () => {
  test("a motion passed by a majority excludes, then a rekey leaves them out", async () => {
    const c = await club(4);
    const [a, b, d, x] = c.people as [Me, Me, Me, Me];
    const motion = createPoll(
      c.g,
      a,
      c.ring,
      {
        q: "Exclude m3?",
        options: ["yes", "no"],
        multi: false,
        closes: 5 * HOUR,
        exclude: x.card.key,
      },
      2 * HOUR,
    );
    const mid = c.add(motion);
    for (const p of [a, b, d]) c.add(createVote(c.g, p, motion, mid, [0], 0, 3 * HOUR));
    // Not closed yet.
    expect((await c.view(a, 4 * HOUR)).members).toHaveLength(4);
    let v = await c.view(a, 6 * HOUR);
    expect(v.members).toHaveLength(3);
    expect(v.excluded[0]?.key).toBe(x.card.key);
    expect(v.needsRekey).toBe(true);
    // a rekeys for the remaining members.
    const key = randomBytes(32);
    c.add(createKeyEvent(c.g, a, key, v.members, 7 * HOUR));
    v = await c.view(b, 8 * HOUR);
    expect(v.needsRekey).toBe(false);
    expect(v.writeKey).toEqual(key);
    expect(v.keys.has(keyId(key))).toBe(true);
    const vx = await c.view(x, 8 * HOUR);
    expect(vx.me).toBeUndefined();
    expect(vx.keys.has(keyId(key))).toBe(false);
    // The excluded member can no longer be in a ring, nor rekey.
    const ring = [...currentRing(v), x.card.key].sort();
    c.add(
      createPoll(
        c.g,
        x,
        ring,
        { q: "?", options: ["x", "y"], multi: false, closes: 20 * HOUR },
        9 * HOUR,
      ),
    );
    c.add(createKeyEvent(c.g, x, randomBytes(32), [x.card], 9 * HOUR));
    v = await c.view(a, 10 * HOUR);
    expect(v.polls.filter((p) => !p.poll.exclude)).toHaveLength(0);
    expect(v.writeKey).toEqual(key);
  });

  test("a motion without a majority of the ring fails", async () => {
    const c = await club(4);
    const [a, b, , x] = c.people as [Me, Me, Me, Me];
    const motion = createPoll(
      c.g,
      a,
      c.ring,
      { q: "?", options: ["yes", "no"], multi: false, closes: 5 * HOUR, exclude: x.card.key },
      2 * HOUR,
    );
    const mid = c.add(motion);
    for (const p of [a, b]) c.add(createVote(c.g, p, motion, mid, [0], 0, 3 * HOUR));
    const v = await c.view(a, 6 * HOUR);
    expect(v.members).toHaveLength(4);
    expect(v.polls[0]?.passed).toBe(false);
  });

  test("newcomers after a rekey are listed for a grant", async () => {
    const c = await club(2);
    const [a] = c.people as [Me, Me];
    const key = randomBytes(32);
    const v0 = await c.view();
    c.add(createKeyEvent(c.g, a, key, v0.members, 2 * HOUR));
    const z = newMe("z");
    c.add(createAdmit(c.g, z, { vouches: [vouchFor(c.g, a, z.card)] }, 3 * HOUR));
    let v = await c.view(a, 4 * HOUR);
    expect(v.needsGrant.map((m) => m.key)).toEqual([z.card.key]);
    c.add(createKeyEvent(c.g, a, key, [z.card], 4 * HOUR));
    v = await c.view(z, 5 * HOUR);
    expect(v.needsGrant).toEqual([]);
    expect(v.writeKey).toEqual(key);
  });
});

test("forged ring signatures are rejected", async () => {
  const c = await club(3);
  const [a] = c.people as [Me, Me, Me];
  const poll = createPoll(
    c.g,
    a,
    c.ring,
    { q: "?", options: ["x", "y"], multi: false, closes: 5 * HOUR },
    2 * HOUR,
  );
  c.add({ ...poll, q: "edited" });
  expect((await c.view()).polls).toHaveLength(0);
});
