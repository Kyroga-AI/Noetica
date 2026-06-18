/**
 * context-cache.ts — Stable workspace prefix for Ollama KV cache warming.
 *
 * Builds a deterministic markdown preamble for a given sessionId that does not
 * change while the graph's logicalClock is unchanged. Because Ollama's KV cache
 * is keyed on the token sequence, an identical prefix string on repeated
 * requests within a session produces a cache hit with no re-encode cost.
 *
 * Cache invalidation strategy: key = `${sessionId}:${clock}`. A single call to
 * buildWorkspacePrefix checks the cache first; if the clock has not advanced it
 * returns the stored entry immediately, otherwise it rebuilds and re-caches.
 */

import { getGraph } from './graph.js'
import type { GraphNode } from '@socioprophet/hellgraph'

// ─── Public types ─────────────────────────────────────────────────────────────

export interface WorkspacePrefix {
  sessionId: string
  prefix: string
  graphClock: number
  builtAt: string
  tokenEstimate: number
}

// ─── Module-level cache ───────────────────────────────────────────────────────

// key = `${sessionId}:${clock}`
const prefixCache = new Map<string, WorkspacePrefix>()

// ─── Exported API ─────────────────────────────────────────────────────────────

/**
 * Returns the cached prefix for sessionId if the graph logicalClock has not
 * advanced since it was built. Returns null when a rebuild is needed.
 */
export function getWorkspacePrefix(sessionId: string): WorkspacePrefix | null {
  const g = getGraph()
  const clock = g.logicalClock
  return prefixCache.get(`${sessionId}:${clock}`) ?? null
}

/**
 * Builds (or returns cached) workspace prefix markdown for sessionId.
 *
 * 1. Get graph + logicalClock.
 * 2. Return cache hit if clock unchanged.
 * 3. Traverse HAS_INTERACTION edges from the session node to collect
 *    interaction nodes (up to 10 most recent by timestamp).
 * 4. Extract entity names from adjacent ConceptNodes (ROUTED_TO → Model).
 * 5. Assemble markdown prefix.
 * 6. Store in cache under `${sessionId}:${clock}` and return.
 */
export function buildWorkspacePrefix(sessionId: string): WorkspacePrefix {
  const g = getGraph()
  const clock = g.logicalClock

  // Fast path: return cached entry when clock has not advanced
  const cacheKey = `${sessionId}:${clock}`
  const cached = prefixCache.get(cacheKey)
  if (cached) return cached

  const sessionNodeId = `urn:noetica:session:${sessionId}`

  // Collect interactions via HAS_INTERACTION edges (session → interaction)
  const interactionNodes: GraphNode[] = g
    .out(sessionNodeId, 'HAS_INTERACTION')
    .filter((n) => n.labels.includes('Interaction'))

  // Sort by timestamp descending and take last 10
  const sorted = [...interactionNodes].sort((a, b) => {
    const ta = String(a.properties.timestamp ?? a.createdAt ?? '')
    const tb = String(b.properties.timestamp ?? b.createdAt ?? '')
    return tb.localeCompare(ta)
  })
  const recent = sorted.slice(0, 10)

  // Collect model names via ROUTED_TO edges
  const modelNames: string[] = []
  for (const interaction of recent) {
    const models = g.out(interaction.id, 'ROUTED_TO')
    for (const m of models) {
      const mid = String(m.properties.modelId ?? m.id)
      if (!modelNames.includes(mid)) modelNames.push(mid)
    }
  }

  // Collect entity/concept names from ConceptNodes adjacent to the session
  // (anything reachable one hop out, labels include known entity types)
  const entityLabels = new Set(['SaeFeature', 'Provider', 'Evidence'])
  const entityNames: string[] = []
  for (const neighbor of g.out(sessionNodeId)) {
    if (neighbor.labels.some((l) => entityLabels.has(l))) {
      const name = String(
        neighbor.properties.featureId ??
        neighbor.properties.providerId ??
        neighbor.properties.hash ??
        neighbor.id,
      )
      if (!entityNames.includes(name)) entityNames.push(name)
    }
  }

  // Build markdown prefix
  const interactionCount = interactionNodes.length
  const modelsLine = modelNames.length > 0 ? modelNames.join(', ') : 'none'
  const topicsLine = entityNames.length > 0 ? entityNames.slice(0, 12).join(', ') : 'none'

  const recentLines = recent.map((n) => {
    const ts = String(n.properties.timestamp ?? n.createdAt ?? '')
    const model = String(n.properties.modelRouted ?? '')
    const promptSummary = String(n.properties.promptSummary ?? '').slice(0, 120)
    const responseSummary = String(n.properties.responseSummary ?? '').slice(0, 120)
    const modelTag = model ? `${model}` : 'model'
    return `- ${ts} ${modelTag}: ${promptSummary} → ${responseSummary}`
  })

  const prefix = [
    `## Session Context`,
    `Interactions: ${interactionCount} | Models: ${modelsLine} | Topics: ${topicsLine}`,
    `### Recent`,
    ...(recentLines.length > 0 ? recentLines : ['- (no interactions yet)']),
  ].join('\n')

  const tokenEstimate = Math.ceil(prefix.length / 4)

  const entry: WorkspacePrefix = {
    sessionId,
    prefix,
    graphClock: clock,
    builtAt: new Date().toISOString(),
    tokenEstimate,
  }

  prefixCache.set(cacheKey, entry)
  return entry
}

/**
 * Remove all cache entries for sessionId (across all clock values).
 * Call after an interaction is ingested to allow the next request to rebuild.
 */
export function invalidatePrefix(sessionId: string): void {
  for (const key of prefixCache.keys()) {
    if (key.startsWith(`${sessionId}:`)) prefixCache.delete(key)
  }
}
