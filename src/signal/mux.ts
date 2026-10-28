/**
 * Runs every enabled signaling transport in parallel: an envelope is
 * broadcast on all of them and the first copy to arrive wins (duplicates are
 * dropped). The swarm on top (../model/swarm.ts) seals and opens envelopes
 * with the group key.
 */
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { DEFAULT_RELAYS, NostrTransport } from "./nostr";
import { DEFAULT_TRACKERS, TorrentTransport } from "./torrent";
import type { SignalTransport, TransportHandlers, TransportName, TransportStatus } from "./types";

export interface SignalConfig {
  nostr: { enabled: boolean; relays: string[] };
  torrent: { enabled: boolean; trackers: string[] };
}

export const DEFAULT_SIGNAL_CONFIG: SignalConfig = {
  nostr: { enabled: true, relays: DEFAULT_RELAYS },
  torrent: { enabled: true, trackers: DEFAULT_TRACKERS },
};

export type TransportFactory = (
  name: TransportName,
  cfg: SignalConfig,
  peerId: string,
  handlers: TransportHandlers,
) => SignalTransport | null;

export const defaultTransportFactory: TransportFactory = (name, cfg, peerId, handlers) => {
  if (name === "nostr" && cfg.nostr.enabled && cfg.nostr.relays.length > 0) {
    return new NostrTransport(cfg.nostr.relays, handlers);
  }
  if (name === "torrent" && cfg.torrent.enabled && cfg.torrent.trackers.length > 0) {
    return new TorrentTransport(cfg.torrent.trackers, peerId, handlers);
  }
  return null;
};

const NETWORK: readonly TransportName[] = ["nostr", "torrent"];
const DEDUP_MS = 5 * 60_000;
/** Envelopes remembered for deduplication, however recent. */
export const MAX_SEEN = 4096;

export interface MuxHandlers {
  onEnvelope(wire: string, topic: Uint8Array, via: TransportName): void;
  onStatus(statuses: TransportStatus[]): void;
}

export class SignalMux {
  readonly transports = new Map<TransportName, SignalTransport>();
  private readonly statuses = new Map<TransportName, TransportStatus>();
  private readonly seen = new Map<string, number>();

  constructor(
    cfg: SignalConfig,
    peerId: string,
    private readonly handlers: MuxHandlers,
    factory = defaultTransportFactory,
  ) {
    for (const name of NETWORK) {
      const t = factory(name, cfg, peerId, {
        onEnvelope: (wire, topic) => this.deliver(wire, topic, name),
        onStatus: (s) => {
          this.statuses.set(name, s);
          this.handlers.onStatus(this.status());
        },
      });
      if (t) this.transports.set(name, t);
    }
  }

  private deliver(wire: string, topic: Uint8Array, via: TransportName): void {
    // The whole envelope, hashed: keyed on a prefix, a relay could send a corrupted copy first
    // and get the genuine one dropped as a duplicate.
    const key = `${topic[0]}:${topic[1]}:${bytesToHex(sha256(utf8ToBytes(wire)).subarray(0, 16))}`;
    const now = Date.now();
    if (this.seen.has(key)) return;
    this.seen.set(key, now);
    if (this.seen.size > MAX_SEEN / 2)
      for (const [k, t] of this.seen) if (now - t > DEDUP_MS) this.seen.delete(k);
    // Still full of recent ones (a relay can send many at once): the oldest go, a map iterates
    // in insertion order. A copy of one of them is then a harmless duplicate upstream.
    for (const k of this.seen.keys()) {
      if (this.seen.size <= MAX_SEEN) break;
      this.seen.delete(k);
    }
    this.handlers.onEnvelope(wire, topic, via);
  }

  join(topic: Uint8Array): void {
    for (const t of this.transports.values()) t.join(topic);
  }

  leave(topic: Uint8Array): void {
    for (const t of this.transports.values()) t.leave(topic);
  }

  send(topic: Uint8Array, wire: string, opts: { to?: string } = {}): void {
    for (const t of this.transports.values()) t.send(topic, wire, opts.to);
  }

  status(): TransportStatus[] {
    return [...this.transports.keys()].map(
      (name) => this.statuses.get(name) ?? { name, state: "connecting", endpoints: [] },
    );
  }

  close(): void {
    for (const t of this.transports.values()) t.close();
    this.transports.clear();
  }
}
