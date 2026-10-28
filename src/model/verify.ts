/**
 * Signature checks, one event at a time, with the verdicts cached: a ring
 * signature over 256 members costs about 130 ms, so each is checked once per
 * device. Ring checks can be handed to a worker (`ringCheck`), so the page
 * stays responsive while a large backlog is verified.
 */
import { verifyTicket } from "../crypto/blind";
import { ringVerify, schnorrVerify } from "../crypto/ristretto";
import { fromB64u } from "../lib/bytes";
import {
  type AgoraEvent,
  createTag,
  DOMAIN,
  pledgeTag,
  signedMessage,
  validChoice,
  voteTag,
  vouchMessage,
} from "./events";

export type Lookup = (id: string) => AgoraEvent | undefined;

export interface RingJob {
  msg: Uint8Array;
  ring: Uint8Array[];
  sig: Uint8Array;
  tag: Uint8Array;
}

export type RingCheck = (job: RingJob) => Promise<boolean>;

export const inlineRingCheck: RingCheck = async (j) => ringVerify(j.msg, j.ring, j.sig, j.tag);

const keys = (ring: readonly string[]) => ring.map((k) => fromB64u(k));

/**
 * The ring signature an event carries, as a job, or a synchronous verdict for
 * events that need none; `"pending"` while the poll or action it refers to is missing.
 */
export function plan(
  groupId: Uint8Array,
  ev: AgoraEvent,
  lookup: Lookup,
): RingJob | boolean | "pending" {
  try {
    const msg = signedMessage(groupId, ev);
    const sig = fromB64u(ev.sig);
    switch (ev.t) {
      case "genesis":
        return schnorrVerify(DOMAIN.pop, fromB64u(ev.founder.key), msg, sig);
      case "vouch":
        return schnorrVerify(DOMAIN.vouch, fromB64u(ev.by), vouchMessage(groupId, ev.for), sig);
      case "admit": {
        if (!schnorrVerify(DOMAIN.pop, fromB64u(ev.member.key), msg, sig)) return false;
        const vm = vouchMessage(groupId, ev.member);
        for (const v of ev.vouches)
          if (!schnorrVerify(DOMAIN.vouch, fromB64u(v.by), vm, fromB64u(v.sig))) return false;
        if (ev.ticket) {
          const t = ev.ticket;
          if (!verifyTicket(fromB64u(t.sig), groupId, fromB64u(ev.member.key), fromB64u(t.issuer)))
            return false;
        }
        return true;
      }
      case "key":
        return schnorrVerify(DOMAIN.key, fromB64u(ev.by), msg, sig);
      case "poll":
      case "action":
        return { msg, ring: keys(ev.ring), sig, tag: createTag(ev.nonce) };
      case "vote": {
        const poll = lookup(ev.poll);
        if (!poll) return "pending";
        if (poll.t !== "poll" || !validChoice(poll, ev.choice)) return false;
        return { msg, ring: keys(poll.ring), sig, tag: voteTag(groupId, ev.poll) };
      }
      case "pledge": {
        const action = lookup(ev.action);
        if (!action) return "pending";
        if (action.t !== "action") return false;
        return { msg, ring: keys(action.ring), sig, tag: pledgeTag(groupId, ev.action) };
      }
    }
  } catch {
    return false;
  }
}

export class Verifier {
  private readonly verdicts = new Map<string, boolean>();

  constructor(
    private readonly groupId: Uint8Array,
    private readonly ringCheck: RingCheck = inlineRingCheck,
    initial: Iterable<[string, boolean]> = [],
    private readonly onVerdict?: (id: string, ok: boolean) => void,
  ) {
    for (const [id, ok] of initial) this.verdicts.set(id, ok);
  }

  /** Known verdict, or undefined if not checked yet. */
  verdict(id: string): boolean | undefined {
    return this.verdicts.get(id);
  }

  /** Checks every event not checked yet; resolves to the ids found valid. */
  async run(
    events: ReadonlyMap<string, AgoraEvent>,
    onProgress?: (done: number, total: number) => void,
  ): Promise<Set<string>> {
    const lookup: Lookup = (id) => events.get(id);
    const todo = [...events].filter(([id]) => !this.verdicts.has(id));
    let done = 0;
    for (const [id, ev] of todo) {
      const p = plan(this.groupId, ev, lookup);
      if (p === "pending") continue;
      const ok = typeof p === "boolean" ? p : await this.ringCheck(p).catch(() => false);
      this.verdicts.set(id, ok);
      this.onVerdict?.(id, ok);
      onProgress?.(++done, todo.length);
    }
    const valid = new Set<string>();
    for (const [id] of events) if (this.verdicts.get(id)) valid.add(id);
    return valid;
  }
}
