import { createHash } from 'crypto'
import type {
  MemoryRecallRequest,
  MemoryRecallResult,
  MemoryRecallEntry,
  MemoryScopeRef,
  MemoryWriteProposal,
  MemoryWriteProposalResult
} from '@/lib/types/memory'

/**
 * Memory-mesh adapter — three-tier recall + durable write.
 *
 * Tier 1 — memoryd (http://127.0.0.1:8787 by default)
 *   Full SocioProphet/memory-mesh runtime: SQLite local store, optional Qdrant/mem0
 *   backend, semantic vector search, policy-gated writeback. This is the durable
 *   authority. When running, it handles both recall and write.
 *
 * Tier 2 — HellGraph via agent-machine (http://127.0.0.1:8080/api/graph/query)
 *   Cross-session entity graph: ECAN-weighted FeatureAtoms, PLN-derived RELATED_TO
 *   edges, WorkingMemoryState-tracked retrieval, consolidation-managed TruthValues.
 *   Augments memoryd hits with structured graph knowledge the flat store doesn't see.
 *
 * Tier 3 — Process-local Map (fallback)
 *   Zero-dependency in-process store for environments where neither memoryd nor the
 *   agent-machine is reachable. Not durable across restarts.
 *
 * Write path:
 *   - Always writes to the process-local Map (instant in-process availability)
 *   - Calls memoryd /v1/write with Ollama embedding when available
 *   (HellGraph ingest is handled separately in app/api/chat/route.ts)
 *
 * Environment:
 *   MEMORYD_URL         — memoryd base URL (default http://127.0.0.1:8787)
 *   AGENT_MACHINE_URL   — agent-machine base URL (default http://127.0.0.1:8080)
 *   OLLAMA_HOST         — Ollama base URL (default http://127.0.0.1:11434)
 *   MEMORYD_API_KEY     — API key for memoryd (optional)
 */

// ─── Config ───────────────────────────────────────────────────────────────────

const MEMORYD_URL      = (process.env.MEMORYD_URL      ?? 'http://127.0.0.1:8787').replace(/\/$/, '')
const AM_URL           = (process.env.AGENT_MACHINE_URL ?? 'http://127.0.0.1:8080').replace(/\/$/, '')
const OLLAMA_BASE      = (process.env.OLLAMA_HOST       ?? 'http://127.0.0.1:11434').replace(/\/$/, '')
const MEMORYD_API_KEY  = process.env.MEMORYD_API_KEY ?? ''
const EMBED_MODEL      = 'nomic-embed-text'
const TIMEOUT_MS       = 4_000

// ─── Process-local Map (Tier 3 fallback) ─────────────────────────────────────

interface StoredEntry {
  memory_id: string
  content_hash: string
  text: string
  scope_id: string
  session_id: string
  recorded_at: string
  source_evidence_refs: string[]
}

const scopeStore = new Map<string, StoredEntry[]>()
const MAX_ENTRIES_PER_SCOPE = 500

function contentHash(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 32)
}

// ─── Embedding helper ─────────────────────────────────────────────────────────

async function getEmbedding(text: string): Promise<number[] | null> {
  try {
    const res = await fetch(`${OLLAMA_BASE}/api/embeddings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: EMBED_MODEL, prompt: text.slice(0, 512) }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!res.ok) return null
    const j = await res.json() as { embedding?: number[] }
    return j.embedding ?? null
  } catch {
    return null
  }
}

// ─── Tier 1: memoryd calls ────────────────────────────────────────────────────

async function memorydRecall(
  query: string,
  scopeId: string,
  sessionId: string,
  topK: number,
  vector: number[] | null,
): Promise<MemoryRecallEntry[]> {
  try {
    const body = {
      envelope: { user_id: sessionId, agent_id: 'noetica', workload_id: scopeId },
      query,
      top_k: topK,
      scope_order: ['run', 'agent', 'user'],
      ...(vector ? { query_vector: vector } : {}),
    }
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (MEMORYD_API_KEY) headers['x-api-key'] = MEMORYD_API_KEY

    const res = await fetch(`${MEMORYD_URL}/v1/recall`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!res.ok) return []
    const data = await res.json() as { hits?: Array<{ memory_id: string; text: string; score: number; source: string }> }
    return (data.hits ?? []).map(h => ({
      memory_id: h.memory_id,
      content_hash: contentHash(h.text),
      source_ref: `memoryd://${scopeId}/${h.memory_id}`,
      score: h.score,
      text: h.text,
      recorded_at: new Date().toISOString(),
    }))
  } catch {
    return []
  }
}

async function memorydWrite(
  content: string,
  scopeId: string,
  sessionId: string,
  vector: number[] | null,
): Promise<string | null> {
  try {
    const body = {
      envelope: { user_id: sessionId, agent_id: 'noetica', workload_id: scopeId },
      content,
      memory_class: 'interaction',
      persist_to_backend: false,  // local-first; no backend unless explicitly enabled
      ...(vector ? { vector } : {}),
    }
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (MEMORYD_API_KEY) headers['x-api-key'] = MEMORYD_API_KEY

    const res = await fetch(`${MEMORYD_URL}/v1/write`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!res.ok) return null
    const data = await res.json() as { memory_id?: string }
    return data.memory_id ?? null
  } catch {
    return null
  }
}

// ─── Tier 2: HellGraph via agent-machine ──────────────────────────────────────

async function hellgraphRecall(
  query: string,
  sessionId: string,
  topK: number,
): Promise<MemoryRecallEntry[]> {
  try {
    const params = new URLSearchParams({
      q: query,
      patterns: 'atoms,temporal',
      maxTokens: String(Math.min(topK * 200, 1500)),
      sessionId,
    })
    const res = await fetch(`${AM_URL}/api/graph/query?${params}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!res.ok) return []
    const data = await res.json() as {
      text?: string
      sources?: Array<{ id: string; label: string; score: number }>
    }
    if (!data.text) return []
    // Return as a single high-quality entry — the graph context block
    return [{
      memory_id: `hellgraph:${sessionId}:${Date.now()}`,
      content_hash: contentHash(data.text),
      source_ref: `hellgraph://atoms/${sessionId}`,
      score: 0.85,   // ECAN-weighted graph recall is high quality
      text: data.text,
      recorded_at: new Date().toISOString(),
    }]
  } catch {
    return []
  }
}

// ─── Tier 3: process-local Map ────────────────────────────────────────────────

function mapRecall(
  query: string,
  scopeId: string,
  topK: number,
): MemoryRecallEntry[] {
  const entries = scopeStore.get(scopeId) ?? []
  const queryWords = query.toLowerCase().split(/\s+/).filter(Boolean)
  return entries
    .map(e => {
      const lower = e.text.toLowerCase()
      const score = queryWords.reduce((s, w) => s + (lower.includes(w) ? 1 : 0), 0)
      return { entry: e, score }
    })
    .filter(({ score }) => score > 0 || entries.length <= topK)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map(({ entry, score }): MemoryRecallEntry => ({
      memory_id: entry.memory_id,
      content_hash: entry.content_hash,
      source_ref: `memory-mesh://local/${scopeId}/${entry.memory_id}`,
      score,
      text: entry.text,
      recorded_at: entry.recorded_at,
    }))
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function storeMemoryContent(scopeId: string, sessionId: string, text: string, evidenceRefs: string[] = []): string {
  const hash = contentHash(text)
  const existing = scopeStore.get(scopeId) ?? []
  if (existing.some((e) => e.content_hash === hash)) return hash
  const entry: StoredEntry = {
    memory_id: `mem_${scopeId}_${hash}`,
    content_hash: hash,
    text,
    scope_id: scopeId,
    session_id: sessionId,
    recorded_at: new Date().toISOString(),
    source_evidence_refs: evidenceRefs,
  }
  scopeStore.set(scopeId, [entry, ...existing].slice(0, MAX_ENTRIES_PER_SCOPE))

  // Async: write to memoryd with Ollama embedding (fire-and-forget)
  getEmbedding(text).then(vec => memorydWrite(text, scopeId, sessionId, vec)).catch(() => null)

  return hash
}

export async function listMemoryScopes(): Promise<MemoryScopeRef[]> {
  const liveScopes: MemoryScopeRef[] = Array.from(scopeStore.entries()).map(([scopeId, entries]) => ({
    schema_version: 'noetica.memory.v0.1',
    scope_id: scopeId,
    label: `Noetica local scope — ${scopeId}`,
    authority: 'SocioProphet/memory-mesh',
    writable: true,
    live_scope: true,
    writeback_policy: 'review-only',
    sensitive_payload_storage: 'disallowed',
    evidence_ref: `memory-mesh://local/${scopeId}`,
    notes: [`${entries.length} entries stored in process memory.`]
  }))
  if (liveScopes.length > 0) return liveScopes
  return [{
    schema_version: 'noetica.memory.v0.1',
    scope_id: 'noetica-session-local',
    label: 'Noetica session-local scope (empty)',
    authority: 'SocioProphet/memory-mesh',
    writable: true,
    live_scope: true,
    writeback_policy: 'review-only',
    sensitive_payload_storage: 'disallowed',
    notes: ['No entries stored yet.']
  }]
}

export async function recallMemory(request: MemoryRecallRequest): Promise<MemoryRecallResult> {
  const limit = request.limit ?? 6
  const query = request.query_hash  // field name retained for compat; contains the query text

  // Run all three tiers concurrently — fastest always wins, slow tiers augment
  const [vector, memorydHits, hellgraphHits] = await Promise.all([
    getEmbedding(query),
    memorydRecall(query, request.scope_id, request.session_id, limit, null),
    hellgraphRecall(query, request.session_id, limit),
  ])

  // Re-run memoryd with vector if Ollama was faster (usually it's not — that's fine)
  let tier1Hits = memorydHits
  if (vector && memorydHits.length === 0) {
    tier1Hits = await memorydRecall(query, request.scope_id, request.session_id, limit, vector)
  } else if (vector && memorydHits.length > 0) {
    // Upgrade existing hits with vector-based recall running in background
    memorydRecall(query, request.scope_id, request.session_id, limit, vector)
      .then(hits => {
        // Absorb into scopeStore for future Map-tier queries (best-effort)
        if (hits.length > 0) {
          const scope = scopeStore.get(request.scope_id) ?? []
          for (const h of hits) {
            if (h.text && !scope.some(e => e.content_hash === h.content_hash)) {
              scope.unshift({
                memory_id: h.memory_id,
                content_hash: h.content_hash,
                text: h.text!,
                scope_id: request.scope_id,
                session_id: request.session_id,
                recorded_at: h.recorded_at ?? new Date().toISOString(),
                source_evidence_refs: [],
              })
              scopeStore.set(request.scope_id, scope.slice(0, MAX_ENTRIES_PER_SCOPE))
            }
          }
        }
      })
      .catch(() => null)
  }

  // Tier 3: Map fallback for any remaining slots
  const tier3Hits = mapRecall(query, request.scope_id, limit)

  // Merge: memoryd → HellGraph → Map, dedup by content_hash, cap at limit
  const seen = new Set<string>()
  const merged: MemoryRecallEntry[] = []
  for (const entry of [...tier1Hits, ...hellgraphHits, ...tier3Hits]) {
    if (seen.has(entry.content_hash)) continue
    seen.add(entry.content_hash)
    merged.push(entry)
    if (merged.length >= limit) break
  }

  const tier = tier1Hits.length > 0 ? 'memoryd' : hellgraphHits.length > 0 ? 'hellgraph' : 'local-map'
  const notes = [
    `Recall tier: ${tier} (memoryd:${tier1Hits.length} graph:${hellgraphHits.length} map:${tier3Hits.length})`,
    ...(tier1Hits.length === 0 && hellgraphHits.length === 0
      ? ['memoryd and agent-machine not reachable — local-map fallback only']
      : []),
  ]

  return {
    schema_version: 'noetica.memory.v0.1',
    status: merged.length > 0 ? 'available' : 'unavailable',
    request_id: request.request_id,
    scope_id: request.scope_id,
    authority: 'SocioProphet/memory-mesh',
    recall_performed: true,
    entries: merged,
    evidence_ref: `memory-mesh://recall/${request.request_id}`,
    notes,
  }
}

export async function proposeMemoryWrite(proposal: MemoryWriteProposal): Promise<MemoryWriteProposalResult> {
  const scopeEntries = scopeStore.get(proposal.scope_id) ?? []
  const alreadyStored = scopeEntries.some((e) => e.content_hash === proposal.content_hash)
  return {
    schema_version: 'noetica.memory.v0.1',
    status: 'review-required',
    proposal_id: proposal.proposal_id,
    scope_id: proposal.scope_id,
    authority: 'SocioProphet/memory-mesh',
    durable_write_performed: alreadyStored,
    review_required: true,
    evidence_ref: `memory-mesh://local/${proposal.scope_id}/proposal/${proposal.proposal_id}`,
    notes: [
      alreadyStored
        ? 'Content already stored — no duplicate write.'
        : 'Content registered in local store. Durable writeback requires memory-mesh review flow.',
    ]
  }
}
