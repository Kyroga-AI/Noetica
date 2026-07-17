/**
 * grl-federation.ts — the Graph-RL side of the sovereign, opt-in learning mesh.
 *
 * Mirrors commons-federation.ts, but carries LEARNING signals instead of chats: a node opts in to
 * publish gate-redacted reward sufficient-statistics (action × coarse graph-state bucket × reward) to
 * the shared grl-mesh aggregator, and pulls the community PRIOR to warm-start its local LinUCB policy.
 * Raw contexts never leave the node — only the coarse bucket + scalar reward — and it is opt-in +
 * fail-open-local: no mesh configured → the local Graph-RL loop just runs on its own.
 *
 * Env: GRL_MESH_URL (e.g. http://grl-mesh.socioprophet.svc.cluster.local:8080),
 *      GRL_MESH_TOKEN (this node's write token), GRL_MESH_SOVEREIGN_ID (the node pseudonym).
 */

interface MeshConfig { base: string; token: string; node: string }

function config(): MeshConfig | null {
  const base = (process.env['GRL_MESH_URL'] ?? '').replace(/\/$/, '')
  const token = process.env['GRL_MESH_TOKEN'] ?? ''
  const node = process.env['GRL_MESH_SOVEREIGN_ID'] ?? ''
  if (!base || !token || !node) return null // mesh not configured → local-only
  return { base, token, node }
}

export function meshEnabled(): boolean { return config() !== null }

/**
 * Coarse graph-state bucket for a featurized context — the ONLY state that leaves the node, so it must
 * be non-identifying: trust level × size × grounded. Mirrored by contextFromBucket for warm-start.
 * Context layout (graph-state.ts): [bias, highTrust, observed, derived, hypothesis, size, density,
 * topNodeShare, grounded, specificity].
 */
export function bucketOf(context: number[]): string {
  const trust = context[1] ?? 0, size = context[5] ?? 0, grounded = (context[8] ?? 0) >= 0.5 ? 1 : 0
  const t = trust >= 0.6 ? 'hi' : trust >= 0.3 ? 'md' : 'lo'
  const s = size >= 0.6 ? 'lg' : size >= 0.3 ? 'md' : 'sm'
  return `t:${t}|s:${s}|g:${grounded}`
}

/** A representative context for a bucket (mid-points) so a pulled prior can be applied as pseudo-observations. */
export function contextFromBucket(bucket: string): number[] {
  const m = Object.fromEntries(bucket.split('|').map((kv) => kv.split(':'))) as Record<string, string>
  const trust = m['t'] === 'hi' ? 0.8 : m['t'] === 'md' ? 0.45 : 0.15
  const size = m['s'] === 'lg' ? 0.8 : m['s'] === 'md' ? 0.45 : 0.15
  const grounded = m['g'] === '1' ? 1 : 0
  return [1, trust, 1 - trust, 0, 0, size, 0.3, 0.3, grounded, 0.3]
}

export interface Transition { action: string; context: number[]; reward: number }
export interface CommunityPrior { action: string; context_bucket: string; mean_reward: number; n: number }

/** Publish redacted reward observations to the mesh. Opt-in, fire-and-forget, never throws into the loop. */
export function publishTransitions(transitions: Transition[], policy = 'retrieval-mode', fetchImpl: typeof fetch = fetch): void {
  const cfg = config()
  if (!cfg || transitions.length === 0) return
  const observations = transitions.slice(-500).map((t) => ({
    action: t.action, context_bucket: bucketOf(t.context), reward: t.reward,
  }))
  void (async () => {
    try {
      const res = await fetchImpl(`${cfg.base}/grl/publish`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.token}`, 'x-sovereign-id': cfg.node },
        body: JSON.stringify({ policy, observations }),
        signal: AbortSignal.timeout(8_000),
      })
      if (!res.ok) console.warn(`[grl-federation] publish → HTTP ${res.status}`)
    } catch (e) {
      console.warn(`[grl-federation] publish failed: ${e instanceof Error ? e.message : e}`)
    }
  })()
}

/** Pull the community prior for a policy. Returns [] if the mesh is unconfigured/unreachable (fail-open). */
export async function pullPrior(policy = 'retrieval-mode', fetchImpl: typeof fetch = fetch): Promise<CommunityPrior[]> {
  const cfg = config()
  if (!cfg) return []
  try {
    const res = await fetchImpl(`${cfg.base}/grl/prior?policy=${encodeURIComponent(policy)}`, { signal: AbortSignal.timeout(8_000) })
    if (!res.ok) return []
    const data = (await res.json()) as { priors?: CommunityPrior[] }
    return Array.isArray(data.priors) ? data.priors : []
  } catch {
    return []
  }
}
