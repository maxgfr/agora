import { describe, expect, test } from "bun:test";
import { randomBytes, toHex, utf8 } from "../lib/bytes";
import { blindRequest, newIssuer, signBlinded, unblind, verifyTicket } from "./blind";
import {
  keyPairFromSeed,
  ringImage,
  ringSigLen,
  ringSign,
  ringVerify,
  schnorrSign,
  schnorrVerify,
} from "./ristretto";
import { boxKeyPair, boxOpen, boxSeal, groupKeys, keyId, open, pad, seal, unpad } from "./seal";
import { lock, newVaultKey, openVault, sealVault, unlock } from "./vault";

const members = Array.from({ length: 6 }, () => keyPairFromSeed(randomBytes(32)));
const ring = members.map((m) => m.pub);

describe("schnorr", () => {
  test("signs and verifies", () => {
    const m = members[0] as (typeof members)[number];
    const sig = schnorrSign("d", m.secret, utf8("hello"));
    expect(schnorrVerify("d", m.pub, utf8("hello"), sig)).toBe(true);
    expect(schnorrVerify("d", m.pub, utf8("hellO"), sig)).toBe(false);
    expect(schnorrVerify("other", m.pub, utf8("hello"), sig)).toBe(false);
    expect(
      schnorrVerify("d", (members[1] as (typeof members)[number]).pub, utf8("hello"), sig),
    ).toBe(false);
  });
});

describe("lsag", () => {
  const msg = utf8("vote: option 2");
  const tag = utf8("poll-1");

  test("any member signs, every position verifies", () => {
    for (let i = 0; i < members.length; i++) {
      const sig = ringSign(msg, ring, i, (members[i] as (typeof members)[number]).secret, tag);
      expect(sig.length).toBe(ringSigLen(ring.length));
      expect(ringVerify(msg, ring, sig, tag)).toBe(true);
    }
  });

  test("rejects a tampered message, ring, tag or signature", () => {
    const sig = ringSign(msg, ring, 2, (members[2] as (typeof members)[number]).secret, tag);
    expect(ringVerify(utf8("vote: option 3"), ring, sig, tag)).toBe(false);
    expect(ringVerify(msg, [...ring].reverse(), sig, tag)).toBe(false);
    expect(ringVerify(msg, ring, sig, utf8("poll-2"))).toBe(false);
    const other = keyPairFromSeed(randomBytes(32));
    expect(ringVerify(msg, [...ring.slice(0, 5), other.pub], sig, tag)).toBe(false);
    for (const at of [0, 40, sig.length - 1]) {
      const bad = Uint8Array.from(sig);
      bad[at] = (bad[at] as number) ^ 1;
      expect(ringVerify(msg, ring, bad, tag)).toBe(false);
    }
  });

  test("refuses to sign for a key outside the ring", () => {
    const other = keyPairFromSeed(randomBytes(32));
    expect(() => ringSign(msg, ring, 0, other.secret, tag)).toThrow();
  });

  test("same key and tag: same image; another tag: unrelated image", () => {
    const x = (members[3] as (typeof members)[number]).secret;
    const a = ringImage(ringSign(utf8("a"), ring, 3, x, tag));
    const b = ringImage(ringSign(utf8("b"), ring, 3, x, tag));
    const c = ringImage(ringSign(utf8("a"), ring, 3, x, utf8("poll-2")));
    const d = ringImage(
      ringSign(utf8("a"), ring, 4, (members[4] as (typeof members)[number]).secret, tag),
    );
    expect(toHex(a)).toBe(toHex(b));
    expect(toHex(a)).not.toBe(toHex(c));
    expect(toHex(a)).not.toBe(toHex(d));
  });

  test("a ring of one works", () => {
    const m = members[0] as (typeof members)[number];
    const sig = ringSign(msg, [m.pub], 0, m.secret, tag);
    expect(ringVerify(msg, [m.pub], sig, tag)).toBe(true);
  });
});

describe("blind tickets", () => {
  const groupId = randomBytes(16);
  const key = (members[0] as (typeof members)[number]).pub;

  test("the organizer signs blind, the ticket verifies", () => {
    const issuer = newIssuer();
    const req = blindRequest(groupId, key);
    const answer = signBlinded(issuer.secret, req.request);
    const ticket = unblind(answer, req.factor, groupId, key, issuer.pub);
    expect(verifyTicket(ticket, groupId, key, issuer.pub)).toBe(true);
    // What the organizer saw is neither the ticket nor the message.
    expect(toHex(req.request)).not.toBe(toHex(ticket));
    expect(toHex(answer)).not.toBe(toHex(ticket));
  });

  test("a ticket is bound to its key, group and organizer", () => {
    const issuer = newIssuer();
    const req = blindRequest(groupId, key);
    const ticket = unblind(
      signBlinded(issuer.secret, req.request),
      req.factor,
      groupId,
      key,
      issuer.pub,
    );
    const other = (members[1] as (typeof members)[number]).pub;
    expect(verifyTicket(ticket, groupId, other, issuer.pub)).toBe(false);
    expect(verifyTicket(ticket, randomBytes(16), key, issuer.pub)).toBe(false);
    expect(verifyTicket(ticket, groupId, key, newIssuer().pub)).toBe(false);
  });

  test("an answer from the wrong organizer is refused", () => {
    const req = blindRequest(groupId, key);
    const answer = signBlinded(newIssuer().secret, req.request);
    expect(() => unblind(answer, req.factor, groupId, key, newIssuer().pub)).toThrow();
  });
});

describe("seal", () => {
  const g = groupKeys(randomBytes(32));

  test("seals and opens, under the key named in the header", () => {
    const keys = new Map([[keyId(g.linkKey), g.linkKey]]);
    const sealed = seal(g.linkKey, g.groupId, utf8("hello"));
    expect(new TextDecoder().decode(open(keys, g.groupId, sealed))).toBe("hello");
    expect(() => open(new Map(), g.groupId, sealed)).toThrow();
    expect(() => open(keys, randomBytes(16), sealed)).toThrow();
    const bad = Uint8Array.from(sealed);
    bad[bad.length - 1] = (bad[bad.length - 1] as number) ^ 1;
    expect(() => open(keys, g.groupId, bad)).toThrow();
  });

  test("pads to power-of-two buckets", () => {
    expect(pad(utf8("x")).length).toBe(256);
    expect(pad(new Uint8Array(300)).length).toBe(512);
    expect(new TextDecoder().decode(unpad(pad(utf8("abc"))))).toBe("abc");
  });

  test("boxes open only for their recipient and context", () => {
    const a = boxKeyPair(randomBytes(32));
    const b = boxKeyPair(randomBytes(32));
    const box = boxSeal(a.pub, utf8("key"), utf8("ctx"));
    expect(new TextDecoder().decode(boxOpen(a.secret, box, utf8("ctx")) ?? new Uint8Array())).toBe(
      "key",
    );
    expect(boxOpen(b.secret, box, utf8("ctx"))).toBeNull();
    expect(boxOpen(a.secret, box, utf8("other"))).toBeNull();
  });
});

describe("vault", () => {
  test("a key derived once seals every save, and the passphrase opens them", async () => {
    const vk = await newVaultKey("correct horse");
    for (const text of ["first", "second"]) {
      const { data, vk: again } = await openVault("correct horse", sealVault(vk, utf8(text)));
      expect(new TextDecoder().decode(data)).toBe(text);
      expect(again.key).toEqual(vk.key);
    }
    await expect(openVault("wrong", sealVault(vk, utf8("x")))).rejects.toThrow();
  });

  test("locks and unlocks; a wrong passphrase fails", async () => {
    const blob = await lock("correct horse", utf8("secret"));
    expect(new TextDecoder().decode(await unlock("correct horse", blob))).toBe("secret");
    await expect(unlock("wrong", blob)).rejects.toThrow();
  });
});
