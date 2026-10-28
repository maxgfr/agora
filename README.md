# agora

Polls and collective actions for a group, end-to-end encrypted: **one real person, one vote,
and nobody knows who voted what.** No account, no server of ours.

**[Open agora in your browser](https://maxgfr.github.io/agora/)** ·
[Protocol](PROTOCOL.md) · [Security model](SECURITY.md)

Most anonymous polls choose between two bad options: anyone can vote as many times as they like,
or the organizer sees who voted what. agora keeps both properties at once:

- **There is someone real behind each vote.** A person only becomes a member once the group
  admits them: either **vouched for by members** who know them (in person, by scanning a code),
  or with a **blind ticket from an organizer** who checked them their own way.
- **Nobody can tell which member cast which vote**, not the other members, not the organizer,
  not the relays. Each vote carries a **linkable ring signature**: it proves that one member of
  the poll's ring signed it, without saying which, and that this member has not voted before
  (a second vote from the same member replaces the first).

## What it does

- **Groups** from an invitation link. The group key lives in the link's `#fragment`, never sent
  to a server. Anyone with the link can read the group and ask to join; only admitted members
  can vote.
- **Two ways in**, chosen when the group is created (one or both):
  - **Vouching**: a newcomer shows a QR code; `k` members scan it and vouch (or compare five
    emojis over a call). Their device admits itself once it has enough vouches.
  - **Organizer tickets**: the organizer checks the person (ID at the door, a membership list…),
    then signs their ticket request *blind* (BLS on BLS12-381). The organizer knows who got a
    ticket, but cannot link it to the member key it admits; the admission is published after a
    random delay so its timing does not give it away either.
- **Polls**: single or multiple choice, a closing time, live results. You can change your vote
  until it closes. The ring of possible voters is frozen when the poll is created.
- **Collective actions**: "I'm in if at least N members are." Commitments are anonymous and
  counted once each; everyone sees when the threshold is reached, nobody sees who committed.
- **Exclusion** by a motion: a poll that excludes a member if more than half of its ring votes
  yes. The group key is then replaced and boxed to the remaining members only.
- **Sync without a server**: sealed events are stored on public **Nostr relays** (they only see an
  opaque tag and ciphertext), and devices online at the same time also sync **peer to peer over
  WebRTC**, so a vote still spreads if every relay drops it.
- **Installable PWA**, works offline once loaded, English and French, optional **passphrase lock**
  of the device's keys (Argon2id), strict CSP, Trusted Types, no telemetry.

## How it works, in one paragraph

Each member holds, per group, a ristretto255 key (voting, signing) and an X25519 key (receiving
group keys). The roster is the set of keys admitted by valid vouches or tickets, replayed in
time order by every device. A poll fixes its ring (the members at that moment); a vote is an
LSAG signature over that ring with a key image `I = x·H_p(poll)`: the same member always gives the
same image for a poll (so double votes are caught), and unrelated images across polls (so votes
cannot be linked from one poll to the next). Every device verifies every signature and counts on
its own; two devices with the same events always show the same results. The full specification
is in [PROTOCOL.md](PROTOCOL.md).

## Limits

agora is honest about what it does not do (details in [SECURITY.md](SECURITY.md)):

- In ticket mode the **organizer is trusted**: they could mint tickets for fake members. The app
  shows how many members came in with a ticket so the group can compare with reality.
- It is **not coercion-resistant**: someone can prove how they voted by revealing their key.
- **Relays see IP addresses and timing**, though never content or who is who.
- Results are computed from the events a device has received.
- Groups are capped at **256 members** (a vote over the whole group is then about 8 KiB and is
  checked in about 130 ms, in a worker).

## Develop

[Bun](https://bun.sh) 1.4, nothing else.

```sh
bun install
bun run dev        # http://localhost:5173, with a local Nostr relay and tracker
bun run test       # unit tests: crypto, roster, tallies, sessions over a relay, P2P sync
bun run test:e2e   # Playwright: three browsers vouch, take a ticket, vote and commit
bun run lint && bun run typecheck && bun run build && bun run check-size
```

The code: `src/crypto` (ring signatures, blind tickets, sealing, the vault), `src/model` (events,
the roster fold, sessions, sync), `src/signal` and `src/net` (Nostr, WebTorrent, WebRTC, shared
with [hush](https://github.com/maxgfr/hush)), `src/ui` (Preact).

## License

MIT
