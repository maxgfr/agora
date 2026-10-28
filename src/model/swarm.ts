/**
 * Peer-to-peer sync between the group's devices that are online at the same
 * time. Devices meet on the group's signal topic (Nostr relays, WebTorrent
 * trackers), with every signaling message sealed under the link key, and
 * open WebRTC links: the lower tag offers, the higher answers. Over a link,
 * each side says which sealed events it holds, asks for what it lacks, and
 * pushes new events as they come. Relays then are only one path among two:
 * a vote reaches the members online even if every relay dropped it.
 */
import { type GroupKeys, keyId, open as openSealed, seal } from "../crypto/seal";
import { fromB64u, fromUtf8, randomBytes, toB64u, toHex, utf8 } from "../lib/bytes";
import { RtcLink } from "../net/peer";
import { type SignalConfig, SignalMux, type TransportFactory } from "../signal/mux";
import type { TransportStatus } from "../signal/types";

export const MAX_PEERS = 6;
const HELLO_MS = 20_000;
const NEGOTIATION_MS = 25_000;
const BATCH = 40;

interface Signal {
  k: "hello" | "offer" | "answer";
  from: string;
  to?: string;
  sid?: string;
  sdp?: string;
}

type SyncMessage = { have: string[] } | { want: string[] } | { wires: string[] };

export interface SwarmOptions {
  config: SignalConfig;
  iceServers: RTCIceServer[];
  relayOnly?: boolean;
  factory?: TransportFactory;
  rtc?: typeof RTCPeerConnection;
  gatherTimeoutMs?: number;
}

export interface SwarmHost {
  /** Ids of every sealed event held (see `wireId`). */
  have(): string[];
  wire(id: string): string | undefined;
  /** A sealed event from a peer. */
  receive(wire: string): void;
  onPeers?(count: number): void;
  onStatus?(statuses: TransportStatus[]): void;
}

/** The id of a sealed event on the wire: 16 bytes of its hash. */
export async function wireId(wire: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", utf8(wire));
  return toHex(new Uint8Array(digest).subarray(0, 16));
}

interface Peer {
  link: RtcLink;
  sid: string;
  open: boolean;
  timer?: ReturnType<typeof setTimeout>;
}

export class Swarm {
  readonly tag = toHex(randomBytes(8));
  private readonly mux: SignalMux;
  private readonly peers = new Map<string, Peer>();
  private readonly linkKeys: Map<string, Uint8Array>;
  private hello: ReturnType<typeof setInterval> | undefined;
  private closed = false;

  constructor(
    private readonly g: GroupKeys,
    private readonly host: SwarmHost,
    private readonly opts: SwarmOptions,
  ) {
    this.linkKeys = new Map([[keyId(g.linkKey), g.linkKey]]);
    this.mux = new SignalMux(
      opts.config,
      this.tag.padEnd(20, "0").slice(0, 20),
      {
        onEnvelope: (wire) => this.onSignal(wire),
        onStatus: (s) => host.onStatus?.(s),
      },
      opts.factory,
    );
    this.mux.join(g.signalTopic);
    this.sayHello();
    this.hello = setInterval(() => this.sayHello(), HELLO_MS);
  }

  get peerCount(): number {
    let n = 0;
    for (const p of this.peers.values()) if (p.open) n++;
    return n;
  }

  /** Pushes a new sealed event to every open link. */
  broadcast(wire: string): void {
    for (const [, p] of this.peers) if (p.open) this.sendTo(p, { wires: [wire] });
  }

  close(): void {
    this.closed = true;
    clearInterval(this.hello);
    for (const p of this.peers.values()) p.link.close();
    this.peers.clear();
    this.mux.close();
  }

  private signal(msg: Signal): void {
    const wire = toB64u(seal(this.g.linkKey, this.g.groupId, utf8(JSON.stringify(msg))));
    this.mux.send(this.g.signalTopic, wire);
  }

  private sayHello(): void {
    if (this.closed || this.peers.size >= MAX_PEERS) return;
    this.signal({ k: "hello", from: this.tag });
  }

  private onSignal(wire: string): void {
    if (this.closed) return;
    let msg: Signal;
    try {
      msg = JSON.parse(fromUtf8(openSealed(this.linkKeys, this.g.groupId, fromB64u(wire))));
    } catch {
      return;
    }
    if (typeof msg.from !== "string" || msg.from === this.tag) return;
    if (msg.to !== undefined && msg.to !== this.tag) return;
    const from = msg.from;
    if (msg.k === "hello") {
      if (this.peers.has(from) || this.peers.size >= MAX_PEERS) return;
      if (this.tag < from) void this.offer(from);
      // The other side offers: answer a broadcast hello with one addressed to them, so a device
      // that came online after our last hello hears of us (never answer an addressed hello).
      else if (msg.to === undefined) this.signal({ k: "hello", from: this.tag, to: from });
    } else if (msg.k === "offer" && typeof msg.sdp === "string" && typeof msg.sid === "string") {
      if (this.tag < from) return; // we offer to them, not the reverse
      this.peers.get(from)?.link.close();
      if (this.peers.size >= MAX_PEERS) return;
      void this.answer(from, msg.sid, msg.sdp);
    } else if (msg.k === "answer" && typeof msg.sdp === "string") {
      const p = this.peers.get(from);
      if (!p || p.sid !== msg.sid || p.open) return;
      p.link.acceptAnswer(msg.sdp).catch(() => p.link.close());
    }
  }

  private newPeer(from: string, sid: string): Peer {
    const peer: Peer = {
      sid,
      open: false,
      link: new RtcLink(
        {
          iceServers: this.opts.iceServers,
          ...(this.opts.relayOnly ? { relayOnly: true } : {}),
          ...(this.opts.rtc ? { rtc: this.opts.rtc } : {}),
          ...(this.opts.gatherTimeoutMs ? { gatherTimeoutMs: this.opts.gatherTimeoutMs } : {}),
        },
        {
          onOpen: () => {
            peer.open = true;
            clearTimeout(peer.timer);
            this.host.onPeers?.(this.peerCount);
            this.sendTo(peer, { have: this.host.have() });
          },
          onFrame: (_lane, frame) => this.onFrame(peer, frame),
          onClose: () => {
            clearTimeout(peer.timer);
            if (this.peers.get(from) === peer) this.peers.delete(from);
            this.host.onPeers?.(this.peerCount);
          },
        },
      ),
    };
    peer.timer = setTimeout(() => {
      if (!peer.open) peer.link.close();
    }, NEGOTIATION_MS);
    this.peers.set(from, peer);
    return peer;
  }

  private async offer(to: string): Promise<void> {
    const sid = toHex(randomBytes(8));
    const peer = this.newPeer(to, sid);
    try {
      const sdp = await peer.link.createOffer();
      if (!this.closed) this.signal({ k: "offer", from: this.tag, to, sid, sdp });
    } catch {
      peer.link.close();
    }
  }

  private async answer(to: string, sid: string, offer: string): Promise<void> {
    const peer = this.newPeer(to, sid);
    try {
      const sdp = await peer.link.acceptOffer(offer);
      if (!this.closed) this.signal({ k: "answer", from: this.tag, to, sid, sdp });
    } catch {
      peer.link.close();
    }
  }

  private sendTo(peer: Peer, msg: SyncMessage): void {
    peer.link.send(0, utf8(JSON.stringify(msg))).catch(() => peer.link.close());
  }

  private onFrame(peer: Peer, frame: Uint8Array): void {
    let msg: Partial<{ have: unknown; want: unknown; wires: unknown }>;
    try {
      msg = JSON.parse(fromUtf8(frame));
    } catch {
      return;
    }
    const strings = (v: unknown) =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
    if (msg.have !== undefined) {
      const mine = new Set(this.host.have());
      const want = strings(msg.have).filter((id) => /^[0-9a-f]{32}$/.test(id) && !mine.has(id));
      for (let i = 0; i < want.length; i += 500)
        this.sendTo(peer, { want: want.slice(i, i + 500) });
    }
    if (msg.want !== undefined) {
      const wires = strings(msg.want)
        .map((id) => this.host.wire(id))
        .filter((w): w is string => w !== undefined);
      for (let i = 0; i < wires.length; i += BATCH)
        this.sendTo(peer, { wires: wires.slice(i, i + BATCH) });
    }
    if (msg.wires !== undefined) for (const w of strings(msg.wires)) this.host.receive(w);
  }
}
