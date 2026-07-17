/**
 * http-sync — the real network wire for the edge↔managed HellGraph CRDT sync.
 *
 * sync-engine.ts proved the CRDT converges; sync-transport.ts drives the 3-message anti-entropy round over a
 * pluggable channel but only shipped a LoopbackTransport (in-process). This is the missing wire: delta-state
 * anti-entropy over the SAME sovereign HTTP envelope as the commons + grl-mesh (opt-in, per-node token,
 * sovereign-id pseudonym, fail-open). No Kafka — a node exposes POST /api/graph/sync and peers reconcile by
 * exchanging ONLY the ops the other is missing (by version vector). Two replicas converge in one round-trip pair.
 *
 * Env (opt-in): GRAPH_SYNC_PEERS (comma-separated peer base URLs), GRAPH_SYNC_TOKEN, GRAPH_SYNC_SOVEREIGN_ID.
 */
import { type Replica } from './sync-engine.js'
import { handleSync, type SyncMessage } from './sync-transport.js'

export interface SyncPeersConfig { peers: string[]; token: string; node: string }

export function syncConfig(): SyncPeersConfig | null {
  const peers = (process.env['GRAPH_SYNC_PEERS'] ?? '').split(',').map((p) => p.trim().replace(/\/$/, '')).filter(Boolean)
  const token = process.env['GRAPH_SYNC_TOKEN'] ?? ''
  const node = process.env['GRAPH_SYNC_SOVEREIGN_ID'] ?? ''
  if (peers.length === 0 || !token || !node) return null // sync not configured → local-only
  return { peers, token, node }
}

export function graphSyncEnabled(): boolean { return syncConfig() !== null }

/** Server side: reconcile an inbound sync message against the local replica, return the reply (or null when done). */
export function handlePeerSync(local: Replica, msg: SyncMessage): SyncMessage | null {
  return handleSync(local, msg)
}

/**
 * Client side: run a full anti-entropy round with one peer over HTTP. Announces our version vector, receives the
 * ops we are missing, merges them, and ships back the ops the peer is missing — until neither has more. Opt-in,
 * token-gated, fail-open (a down/hostile peer returns {sent:0,received:0}, never throws into the caller).
 */
export async function syncWithPeer(
  local: Replica,
  peerBase: string,
  opts: { token?: string; node?: string; fetchImpl?: typeof fetch; maxHops?: number } = {},
): Promise<{ sent: number; received: number; ok: boolean }> {
  const f = opts.fetchImpl ?? fetch
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (opts.token) headers['authorization'] = `Bearer ${opts.token}`
  if (opts.node) headers['x-sovereign-id'] = opts.node
  let outbound: SyncMessage | null = { kind: 'announce', from: local.id, vv: Object.fromEntries(local.vv) }
  let sent = 0, received = 0
  const maxHops = opts.maxHops ?? 4
  try {
    for (let hop = 0; hop < maxHops && outbound; hop++) {
      const res = await f(`${peerBase.replace(/\/$/, '')}/api/graph/sync`, {
        method: 'POST', headers, body: JSON.stringify(outbound), signal: AbortSignal.timeout(8_000),
      })
      if (!res.ok) return { sent, received, ok: false }
      const reply = (await res.json()) as SyncMessage | null // the peer's handleSync reply
      if (!reply) break
      if (reply.kind === 'deltas') received += reply.ops.length
      outbound = handleSync(local, reply)                    // merge the peer's ops → my counter-message
      if (outbound?.kind === 'deltas') sent += outbound.ops.length
    }
    return { sent, received, ok: true }
  } catch (e) {
    console.warn(`[http-sync] peer ${peerBase} failed: ${e instanceof Error ? e.message : e}`)
    return { sent, received, ok: false }
  }
}

/** Reconcile with every configured peer (best-effort, sequential to bound load). Returns per-peer results. */
export async function syncAllPeers(local: Replica, fetchImpl: typeof fetch = fetch): Promise<Record<string, { sent: number; received: number; ok: boolean }>> {
  const cfg = syncConfig()
  const out: Record<string, { sent: number; received: number; ok: boolean }> = {}
  if (!cfg) return out
  for (const peer of cfg.peers) {
    out[peer] = await syncWithPeer(local, peer, { token: cfg.token, node: cfg.node, fetchImpl })
  }
  return out
}
