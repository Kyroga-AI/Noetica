/**
 * sync-transport — S0 anti-entropy protocol over a pluggable channel (see docs/edge-service-sync-design.md).
 *
 * sync-engine.ts proved the CRDT MERGE converges; this drives the actual exchange: a bidirectional anti-entropy
 * round where each replica ships only the ops the peer is missing (by version vector), so two replicas reconcile
 * in 3 messages. The Transport interface abstracts the wire — LoopbackTransport (in-process, used by tests + the
 * edge/service-in-one-box case) now; a TriTRPC adapter (cairnpath-mesh frames, with idempotency_key/replay_nonce)
 * later, with zero change to the protocol logic. Engine-agnostic, same as sync-engine.
 */
import { type Replica, type VersionVector, type GraphOp, type ReplicaId, delta, merge } from './sync-engine.js'

export type SyncMessage =
  | { kind: 'announce'; from: ReplicaId; vv: VersionVector }
  | { kind: 'deltas'; from: ReplicaId; ops: GraphOp[]; vv: VersionVector }

/**
 * Handle one inbound message; return the reply to send back, or null when the round is done. Pure over the
 * replica's state (merges in place). This is the whole protocol: announce → deltas-you-need → deltas-I-need.
 */
export function handleSync(local: Replica, msg: SyncMessage): SyncMessage | null {
  if (msg.kind === 'announce') {
    return { kind: 'deltas', from: local.id, ops: delta(local, msg.vv), vv: local.vv }
  }
  merge(local, msg.ops)                 // absorb what the peer sent
  const back = delta(local, msg.vv)     // and tell them what THEY are still missing
  return back.length ? { kind: 'deltas', from: local.id, ops: back, vv: local.vv } : null
}

/**
 * In-process bidirectional anti-entropy between two replicas → both converge. Exactly the message sequence the
 * wire transport performs, run synchronously: a announces, b replies with a's missing ops + b.vv, a merges and
 * replies with b's missing ops, b merges. Three messages, then done.
 */
export function antiEntropy(a: Replica, b: Replica): void {
  const m1 = handleSync(b, { kind: 'announce', from: a.id, vv: a.vv })
  const m2 = m1 ? handleSync(a, m1) : null
  if (m2) handleSync(b, m2)
}

// ── Transport abstraction (the wire) ─────────────────────────────────────────────────────────────────────────
export interface SyncTransport {
  send(msg: SyncMessage): Promise<void>
  onMessage(handler: (msg: SyncMessage) => void): void
}

/** In-process transport pairing two endpoints — for tests + the single-box edge/service case. */
export function loopbackPair(): [SyncTransport, SyncTransport] {
  let ha: ((m: SyncMessage) => void) | null = null
  let hb: ((m: SyncMessage) => void) | null = null
  const a: SyncTransport = { async send(m) { hb?.(m) }, onMessage(h) { ha = h } }
  const b: SyncTransport = { async send(m) { ha?.(m) }, onMessage(h) { hb = h } }
  return [a, b]
}

/** Drive an anti-entropy round over a transport: wire the local replica to reply to inbound messages, then kick
 *  it off by announcing. Returns when the local side has nothing more to send (the peer drives its own side). */
export async function syncOver(local: Replica, transport: SyncTransport, peerVVHint: VersionVector = {}): Promise<void> {
  transport.onMessage((msg) => { const reply = handleSync(local, msg); if (reply) void transport.send(reply) })
  await transport.send({ kind: 'announce', from: local.id, vv: peerVVHint })
}
