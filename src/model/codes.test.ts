import { expect, test } from "bun:test";
import { randomBytes, toB64u, toHex } from "../lib/bytes";
import {
  answerCode,
  cardCode,
  classifyCode,
  inviteFragment,
  organizerCode,
  parseCard,
  requestCode,
} from "./codes";

const gid = toHex(randomBytes(16));
const card = { key: toB64u(randomBytes(32)), box: toB64u(randomBytes(32)), name: "Ada" };

test("codes carry their group, and the scanner tells them apart", () => {
  expect(parseCard(cardCode(card, gid))).toEqual({ value: card, groupId: gid });
  const req = randomBytes(48);
  expect(classifyCode(requestCode(gid, req))).toEqual({
    kind: "request",
    code: { value: req, groupId: gid },
  });
  expect(classifyCode(answerCode(gid, req))?.kind).toBe("answer");
  expect(classifyCode(organizerCode(gid, randomBytes(32)))?.kind).toBe("organizer");
  expect(classifyCode(cardCode(card, gid))?.kind).toBe("card");
  const invite = { secret: randomBytes(32), genesisId: toHex(randomBytes(16)) };
  expect(classifyCode(`https://x/agora/#${inviteFragment(invite)}`)).toEqual({
    kind: "invite",
    invite,
  });
  expect(classifyCode("hello")).toBeNull();
  expect(classifyCode(`AT2.${toB64u(randomBytes(20))}`)).toBeNull();
});

test("version 1 codes (no group) are still read", () => {
  const v1 = `AC1.${toB64u(new Uint8Array([...Buffer.from(card.key, "base64url"), ...Buffer.from(card.box, "base64url"), ...Buffer.from("Ada")]))}`;
  expect(parseCard(v1)).toEqual({ value: card });
  expect(classifyCode(`AT1.${toB64u(randomBytes(48))}`)?.kind).toBe("request");
});
