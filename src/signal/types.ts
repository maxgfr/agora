/** Signaling: how the devices of one group find each other. */

export type TransportName = "nostr" | "torrent";
export type TransportState = "off" | "connecting" | "online" | "error";

export interface EndpointStatus {
  url: string;
  state: TransportState;
  detail?: string;
}

export interface TransportStatus {
  name: TransportName;
  state: TransportState;
  detail?: string;
  endpoints: EndpointStatus[];
}

export interface TransportHandlers {
  /** A raw (still sealed) envelope arrived on `topic`. */
  onEnvelope(wire: string, topic: Uint8Array): void;
  onStatus(status: TransportStatus): void;
}

/**
 * A transport only moves opaque strings around a rendezvous topic. It never
 * sees plaintext: envelopes are sealed before they reach it.
 */
export interface SignalTransport {
  readonly name: TransportName;
  join(topic: Uint8Array): void;
  leave(topic: Uint8Array): void;
  /** Broadcast to the topic, or best-effort direct delivery when the transport can route by peer. */
  send(topic: Uint8Array, wire: string, to?: string): void;
  status(): TransportStatus;
  close(): void;
}

export type WebSocketCtor = new (url: string) => WebSocket;

/**
 * Longest frame taken from a relay or tracker; anything longer is dropped before it is parsed.
 * The largest event the app seals is 96 KiB of plaintext (`MAX_PLAINTEXT`), padded to 128 KiB,
 * then base64url encoded: about 175 KB.
 */
export const MAX_FRAME = 512 * 1024;

/** Exponential backoff with jitter, capped at 30 s. */
export function backoff(attempt: number): number {
  const base = Math.min(30_000, 1000 * 2 ** attempt);
  return base / 2 + Math.random() * (base / 2);
}

/** Overall state of a transport from its endpoints: online if any endpoint is. */
export function aggregateState(endpoints: readonly EndpointStatus[]): TransportState {
  if (endpoints.some((e) => e.state === "online")) return "online";
  if (endpoints.some((e) => e.state === "connecting")) return "connecting";
  return endpoints.length === 0 ? "off" : "error";
}
