import { createHash } from 'crypto'
import type {
  MemoryRecallRequest,
  MemoryRecallResult,
  MemoryRecallEntry,
  MemoryScopeRef,
  MemoryWriteProposal,
  MemoryWriteProposalResult
} from '@/lib/types/memory'

// Process-level in-memory store for cross-request, cross-session memory within
// one server process. Entries are keyed by scope_id → content_hash → record.
// A live SocioProphet/memory-mesh deployment would replace this with durable,
// content-addressed storage backed by the memory-mesh authority. The hash and
// scope contract stays identical; only the backend changes.

interface StoredEntry {
  memory_id: string
  content_hash: string
  text: string
  scope_id: string
  session_id: string
  recorded_at: string
  source_evidence_refs: string[]
}

// Per-scope list of entries, newest first
const scopeStore = new Map<string, StoredEntry[]>()
const MAX_ENTRIES_PER_SCOPE = 500

function contentHash(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 32)
}

// Write a text entry to a scope. Returns the content hash.
// Deduplicates by hash — if an identical entry already exists it is not re-added.
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
  const updated = [entry, ...existing].slice(0, MAX_ENTRIES_PER_SCOPE)
  scopeStore.set(scopeId, updated)
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

  return [
    {
      schema_version: 'noetica.memory.v0.1',
      scope_id: 'noetica-session-local',
      label: 'Noetica session-local scope (empty)',
      authority: 'SocioProphet/memory-mesh',
      writable: true,
      live_scope: true,
      writeback_policy: 'review-only',
      sensitive_payload_storage: 'disallowed',
      notes: ['No entries stored yet.']
    }
  ]
}

export async function recallMemory(request: MemoryRecallRequest): Promise<MemoryRecallResult> {
  const entries = scopeStore.get(request.scope_id) ?? []
  const limit = request.limit ?? 10

  // Simple keyword relevance — score each entry by how many query-hash words appear
  // A live implementation would use vector similarity via the memory-mesh authority
  const queryWords = request.query_hash.toLowerCase().split(/\s+/).filter(Boolean)
  const scored: Array<{ entry: StoredEntry; score: number }> = entries.map((e) => {
    const lower = e.text.toLowerCase()
    const score = queryWords.reduce((s, w) => s + (lower.includes(w) ? 1 : 0), 0)
    return { entry: e, score }
  })

  const relevant = scored
    .filter((s) => s.score > 0 || entries.length <= limit)
    .sort((a, b) => b.score - a.score || b.entry.recorded_at.localeCompare(a.entry.recorded_at))
    .slice(0, limit)
    .map(({ entry, score }): MemoryRecallEntry => ({
      memory_id: entry.memory_id,
      content_hash: entry.content_hash,
      source_ref: `memory-mesh://local/${request.scope_id}/${entry.memory_id}`,
      score,
      text: entry.text,
      recorded_at: entry.recorded_at,
    }))

  return {
    schema_version: 'noetica.memory.v0.1',
    status: 'available',
    request_id: request.request_id,
    scope_id: request.scope_id,
    authority: 'SocioProphet/memory-mesh',
    recall_performed: true,
    entries: relevant,
    evidence_ref: `memory-mesh://local/${request.scope_id}/recall/${request.request_id}`,
    notes: [
      `Process-local recall from scope '${request.scope_id}' — ${entries.length} total entries, ${relevant.length} returned.`,
      'No durable memory-mesh authority consulted — local store only.'
    ]
  }
}

export async function proposeMemoryWrite(proposal: MemoryWriteProposal): Promise<MemoryWriteProposalResult> {
  const scopeEntries = scopeStore.get(proposal.scope_id) ?? []
  const alreadyStored = scopeEntries.some((e) => e.content_hash === proposal.content_hash)

  return {
    schema_version: 'noetica.memory.v0.1',
    status: alreadyStored ? 'review-required' : 'review-required',
    proposal_id: proposal.proposal_id,
    scope_id: proposal.scope_id,
    authority: 'SocioProphet/memory-mesh',
    durable_write_performed: alreadyStored,
    review_required: true,
    evidence_ref: `memory-mesh://local/${proposal.scope_id}/proposal/${proposal.proposal_id}`,
    notes: [
      alreadyStored
        ? 'Content already stored in process-local scope — no duplicate write.'
        : 'Content hash registered. Durable writeback requires memory-mesh review flow.',
      'Local process store is not durable across restarts.'
    ]
  }
}
