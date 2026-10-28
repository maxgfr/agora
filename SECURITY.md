# Security model

## What agora protects

| Property | How |
| --- | --- |
| Content is private to the group | Every event is sealed (XChaCha20-Poly1305) with a key that comes from the invitation's `#fragment` or from a later rekey. Relays and trackers see an opaque tag and ciphertext. |
| One member, one vote | Votes are LSAG ring signatures with a per-poll key image: two votes by one member are recognized, and the later one replaces the earlier. |
| Nobody knows who voted what | The ring signature does not reveal which member of the ring signed (anonymity under DDH in ristretto255). Key images of the same member in two polls are unrelated, so votes cannot be linked across polls. Poll creators are anonymous too. |
| Members are real people | Admission requires `k` vouches from current members, or a blind ticket from an organizer of the group. |
| Asking a member | A newcomer types the member's pseudonym, and the form never says whether it exists (a request always reads as sent): the app never shows the member list to non-members (though anyone holding the link could read the admissions and their names). The request is boxed to that member, so other holders of the link see neither who asks nor whom. |
| The organizer cannot link a ticket to a vote | An entry password is proven with a ring signature over its whole batch: the organizer, who knows whom they gave which password, cannot tell which one was used. A scanned ticket is a blind BLS signature: the organizer never sees the member key it certifies. Either way the admission is published after a random delay. |
| Excluded members lose access | An exclusion removes the key from future rings and is followed by a new group key boxed to the remaining members only. |
| Keys at rest | Optional passphrase lock (Argon2id + XChaCha20-Poly1305) of the profile on the device. |
| The page itself | Strict CSP (`script-src 'self'`, no inline script or style), Trusted Types, frame busting, a service worker that checks the SHA-256 of every cached file. |

## What it does not protect

- **Organizers are trusted in ticket mode.** An organizer can sign tickets for keys they control
  and create fake members. The members list shows how many came in with a ticket, and the
  organizer's desk counts tickets signed, so a group can compare with the people it knows.
  In vouching mode, colluding members can vouch for fake members in the same way.
- **An entry password is a bearer secret.** Whoever types it first gets in, and the person it
  was meant for is then refused: hand it over privately. It is only usable in its own group.
- **The link is read access.** Anyone holding the invitation can read the group's admissions and,
  until the first exclusion, its content. Send it over a channel you trust.
- **No coercion resistance.** A member can prove how they voted by revealing their secret key
  (which lets anyone recompute their key image). A coercer standing next to someone can watch
  them vote.
- **Votes in polls that were already open** when someone was excluded still count: they cannot
  be told apart from the others, by design.
- **Metadata.** Relays and trackers see IP addresses, the topic tag, the size bucket and the
  timing of events (the number of events per group, and when). WebRTC peers see each other's IP
  unless "never reveal my IP" (TURN) is on. Using Tor or a VPN hides your address from them.
- **Timestamps are claimed by their authors.** A voter could backdate a vote to slip it in after
  a poll closes; members would see it appear late.
- **Results depend on what a device received.** Two devices with the same events agree; a relay
  can withhold events (peer-to-peer sync and several relays make this harder).
- **Group size.** Rings are capped at 256 members; a vote is then about 8 KiB.
- **Browser history** holds the screens visited (`#/g/<group id>/polls/<poll id>`): ids, never
  the group secret, which leaves the address bar as soon as an invitation is opened.
- **Device compromise.** Malware on a device, or someone with an unlocked device, can vote as
  its owner.
- **No post-quantum security.** The ring signatures and blind tickets rely on discrete logarithms
  (and pairings): a large quantum computer could break anonymity of recorded votes.

## Reporting a vulnerability

Please use a private security advisory on GitHub
(`Security` → `Report a vulnerability` in this repository), not a public issue.
