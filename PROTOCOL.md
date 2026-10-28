# agora protocol, version 1

This describes what a device sends, stores and checks. The reference implementation is in
`src/crypto` and `src/model`.

## Primitives

| Use | Primitive |
| --- | --- |
| Member keys, vouches, ring signatures | ristretto255 (RFC 9496), SHA-512 |
| Hash to group | `hash_to_ristretto255` (RFC 9380), per-purpose DST |
| Blind tickets | BLS on BLS12-381, signatures in G1 (48 bytes), keys in G2 (96 bytes) |
| Key derivation | HKDF-SHA-256 |
| Event encryption, boxes | XChaCha20-Poly1305 |
| Boxes | X25519 ephemeral-static |
| Device lock | Argon2id (t = 2, m = 19 MiB, p = 1) |
| Relay events | Nostr NIP-01 (secp256k1 Schnorr, one throwaway key per event) |

All signed and hashed inputs are length-prefixed (`u32` big endian) and domain-separated.

## Group keys

A group is a 32-byte secret `S`. With `HKDF(S, info)`:

- `groupId = HKDF(S, "agora/v1/group-id", 16)`, named in every signature;
- `topic = HKDF(S, "agora/v1/topic")`, the hex `#t` tag of the group's relay events;
- `signalTopic = HKDF(S, "agora/v1/signal-topic")`, where devices meet for WebRTC;
- `linkKey = HKDF(S, "agora/v1/link-key")`, the first event key.

A key's id is `SHA-256("agora/v1/key-id" ‖ key)[0..8]`.

The invitation is `https://…/agora/#g=<b64url(S)>.<b64url(genesisId)>`. The genesis id pins the
founding event: an event claiming to be another genesis is ignored.

## Sealed events

```
sealed = 0x01 ‖ keyId (8) ‖ nonce (24) ‖ XChaCha20-Poly1305(key, nonce, aad, pad(json))
aad    = 0x01 ‖ keyId ‖ nonce ‖ groupId
pad(x) = u32(len x) ‖ x ‖ zeros, to the next power of two (at least 256 bytes)
```

Plaintext is at most 96 KiB. On the wire a sealed event is base64url. Its **wire id** is
`SHA-256(wire)[0..16]` (used to de-duplicate and in peer sync). Its **event id** is
`SHA-256(canonical(event))[0..16]`, hex, where `canonical` is JSON with sorted keys; ids name
polls and actions independently of how they were sealed.

`genesis`, `request`, `passes`, `vouch`, `admit` and `key` events are sealed with the link key, so that a newcomer
holding only the invitation can follow admissions. Content events (`poll`, `vote`, `action`,
`pledge`) are sealed with the newest key the author holds.

## Signatures

`signedMessage(ev) = SHA-256("agora/v1/event" ‖ groupId ‖ canonical(ev without sig))`.

**Schnorr** (domain `d`, secret `x`, public `P = xG`): `k` hedged (hash of `x`, the message and
32 random bytes), `R = kG`, `c = H_s(d, R, P, m)`, `s = k + c·x`; signature `R ‖ s` (64 bytes);
check `sG = R + cP`. Domains: `agora/v1/sig/pop` (an event signed by its author),
`agora/v1/sig/vouch`, `agora/v1/sig/key`.

**LSAG with an event tag.** Ring `P_0…P_{n-1}` (sorted, unique), tag `T`,
`H = hash_to_ristretto255(T, DST = "agora/v1/lsag-tag")`, key image `I = x·H`.
Signing at index `π`: random `α`, `c_{π+1} = H_s(D, H, I, m, αG, αH)`; for every other `i`,
random `s_i`, `c_{i+1} = H_s(D, H, I, m, s_iG + c_iP_i, s_iH + c_iI)`; `s_π = α − c_π·x`.
`D = SHA-512(u32(n) ‖ P_0 ‖ … ‖ P_{n-1})`, domain `agora/v1/lsag`.
Signature: `I ‖ c_0 ‖ s_0 ‖ … ‖ s_{n-1}` (`32·(n+2)` bytes). Verification recomputes the chain
from `c_0` and checks it closes. Tags:

| Event | Tag |
| --- | --- |
| `poll`, `action` (creation) | `"agora/v1/tag/create:" ‖ nonce` (fresh: creating is unlinkable) |
| `vote` | `"agora/v1/tag/vote:" ‖ groupId ‖ pollId` |
| `pledge` | `"agora/v1/tag/pledge:" ‖ groupId ‖ actionId` |

**Blind tickets.** `M = hash_to_G1(groupId ‖ memberKey, DST = "AGORA-V1-TICKET_BLS_SIG_BLS12381G1_XMD:SHA-256_SSWU_RO_")`.
The requester picks `r`, sends `r·M`; the organizer returns `sk·r·M`; the requester computes
`σ = r⁻¹·(sk·r·M)` and checks `e(σ, G2) = e(M, pk)`.

## Events

All carry `t` (type), `ts` (milliseconds) and `sig`. Binary fields are base64url.

- `genesis {name, about, policy: {vouches, issuers[]}, founder: card, sig: pop}`
- `request {to, box, sig: pop}` — a newcomer asks the member whose X25519 key is `to` to vouch:
  `box = boxSeal(to, JSON {card}, "agora/v1/request:" ‖ groupId)`; `sig` is the newcomer's pop
  signature, checked by the recipient against the key inside the box (nobody else can check it,
  nor see who asks)
- `passes {issuer, keys[], nonce, sig: BLS}` — a batch of one-time entry passwords: each password
  `p` (12 symbols of `23456789ABCDEFGHJKMNPQRSTUVWXYZ`, ~59 bits) stands for the key
  `keyPairFromSeed("agora/v1/pass-key:" ‖ groupId ‖ p)`; only the public keys are listed, signed
  by the organizer (BLS, DST `AGORA-V1-ISSUER_…`)
- `vouch {for: card, by, sig: vouch}` — a vouch published for the newcomer's device to collect
- `admit {member: card, vouches: [{by, sig}], ticket?: {issuer, sig}, pass?: {batch, sig}, sig: pop}`
  — `pass.sig` is an LSAG over the batch's keys, tag `"agora/v1/tag/pass:" ‖ groupId ‖ batch`,
  message `SHA-256("agora/v1/pass" ‖ groupId ‖ key ‖ box)`: its key image spends the password
- `poll {q, options[2..20], multi, closes, ring[], nonce, exclude?, sig: LSAG(create)}`
- `vote {poll, choice[], seq, sig: LSAG(vote)}`
- `action {title, details, threshold, closes, ring[], nonce, sig: LSAG(create)}`
- `pledge {action, on, seq, sig: LSAG(pledge)}`
- `key {by, kid, boxes: [{to, box}], sig: schnorr}`

A card is `{key, box, name?}`: the ristretto key, the X25519 key, a pseudonym. A vouch signs
`SHA-256("agora/v1/vouch" ‖ groupId ‖ key ‖ box ‖ name)`.

## Folding

Every device folds the events whose signatures check, deterministically
(`src/model/group.ts`):

1. The genesis named by the invitation sets the policy; its founder is the first member.
2. Admissions, polls, actions and key events are replayed in time order (polls, actions and keys
   at `ts + 5 min`, to tolerate clock skew). An `admit` counts if its key is new and not excluded,
   and either it carries vouches from at least `min(k, members)` distinct current members, a
   ticket from one of the policy's organizers, or a password proof over a batch from one of them
   whose key image was not spent before (batches count from `ts − 5 min`).
3. A `poll` or `action` counts if every key of its ring was a member at `ts`.
4. Votes: for each poll, the valid votes with `ts ≤ closes`; per key image, the highest `seq`
   (then the lowest id). Pledges the same way, for actions; an action is reached when the pledges
   that are `on` reach its threshold.
5. A poll with `exclude` takes effect at `closes` if option 0 has more than half of its ring.
   The excluded key leaves the roster and can never be admitted again.
6. Keys: a `key` event by a current member boxes a key to members' X25519 keys
   (`box = eph ‖ nonce ‖ XChaCha20-Poly1305(HKDF(X25519(eph, to), eph ‖ to, "agora/v1/box"), nonce, "agora/v1/box:" ‖ groupId ‖ kid, key)`).
   After an exclusion, the first online member publishes a new key boxed to the remaining
   members; members admitted later get the current key in a further `key` event.

## Codes passed by hand

QR codes or text, each prefixed and base64url (`gid` is the 16-byte group id, so a scanner
knows which group a code is for; version 1 codes have no `gid` and are still read):

| Code | Content |
| --- | --- |
| `AC2.` card | `gid ‖ key ‖ box ‖ utf8(name)` |
| `AT2.` ticket request | `gid ‖ r·M` (48 bytes) |
| `AS2.` ticket answer | `gid ‖ sk·r·M` (48 bytes) |
| `AO2.` organizer key | `gid ‖ BLS secret` (32 bytes) |

## Transport

- **Relays**: each sealed event is a Nostr event of kind 4918 with tag `["t", hex(topic)]`, signed
  by a fresh secp256k1 key. Devices subscribe to `{kinds: [4918], "#t": [topic], since}`.
- **Peers**: devices broadcast sealed `hello` messages (kind 21918, ephemeral) on the signal
  topic, over Nostr and WebTorrent trackers; the lower random tag sends a WebRTC offer, the other
  answers, each sealed with the link key. Over the data channel: `{have: [wireId]}`,
  `{want: [wireId]}`, `{wires: [sealed]}`, and new events are pushed as they come.
