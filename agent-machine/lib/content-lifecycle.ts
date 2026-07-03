/**
 * content-lifecycle.ts — the governed content state machine (the workspace/content model's spine).
 *
 * Every content item flows: IngestedRaw → Normalized → Extracted → Indexed → Served, then may branch to
 * VendorMaterialized (cloud file handle) / FlaggedRetention / LegalHold, and eventually Deleted. Transitions
 * are GATED by the L5 policy engine (isolation-policy) — egress to a cloud vendor is denied for sensitive
 * content, and a legal hold blocks deletion — and every transition is recorded to the append-only audit log.
 *
 * Fits the canonical model: L0 container = ScopeEnvelope (workspace/collection/thread); L1 canonical store =
 * blob-store; L2 derived = doc-store/embed; L3 vendor = the VendorMaterialized branch; L5 = isolation-policy +
 * audit-chain. This module is the discipline that walks an item across those layers.
 */
import { decideIsolation } from './isolation-policy.js'

export type ContentState =
  | 'IngestedRaw' | 'Normalized' | 'Extracted' | 'Indexed' | 'Served'
  | 'VendorMaterialized' | 'ExpiredVendorCache' | 'FlaggedRetention' | 'LegalHold' | 'Deleted'

/** L0 container coordinates — mirrors the ScopeEnvelope hierarchy. */
export interface Container { workspace_id?: string; collection?: string; thread_id?: string }

export interface ContentItem {
  id: string
  state: ContentState
  container: Container
  labels?: string[]
  content?: string      // used for sensitivity classification at egress
  legalHold?: boolean
  createdAt: number
}

/** Legal transitions — the edges from the content-lifecycle diagram. */
export const EDGES: Record<ContentState, ContentState[]> = {
  IngestedRaw: ['Normalized', 'Deleted'],
  Normalized: ['Extracted', 'Deleted'],
  Extracted: ['Indexed', 'Deleted'],
  Indexed: ['Served', 'Deleted'],
  Served: ['VendorMaterialized', 'FlaggedRetention', 'LegalHold', 'Deleted'],
  VendorMaterialized: ['ExpiredVendorCache', 'Served', 'Deleted'],
  ExpiredVendorCache: ['Served', 'Deleted'],
  FlaggedRetention: ['Deleted'],
  LegalHold: ['Served', 'Deleted'],
  Deleted: [],
}

export interface AuditEvent { ts: number; itemId: string; from: ContentState; to: ContentState; ok: boolean; reason: string }
export type AuditHook = (e: AuditEvent) => void // wire to audit-chain.ts (append-only)

export interface TransitionResult { ok: boolean; item: ContentItem; reason: string }

/** Attempt a governed transition. Illegal edges, sensitive egress, and hold-blocked deletes are refused. */
export function transition(item: ContentItem, to: ContentState, opts: { audit?: AuditHook } = {}): TransitionResult {
  const deny = (reason: string): TransitionResult => {
    opts.audit?.({ ts: Date.now(), itemId: item.id, from: item.state, to, ok: false, reason })
    return { ok: false, item, reason }
  }

  if (!EDGES[item.state].includes(to)) return deny(`illegal transition ${item.state} → ${to}`)

  // L5 gate — deletion is blocked while under legal hold (unless the hold itself is being released → Deleted from LegalHold).
  if (to === 'Deleted' && item.legalHold && item.state !== 'LegalHold') return deny('legal hold blocks deletion')

  // L5 gate — VendorMaterialized = egress to a cloud vendor file API; only low-sensitivity may leave the device.
  if (to === 'VendorMaterialized') {
    const d = decideIsolation({ content: item.content, labels: item.labels })
    if (!d.egressAllowed) return deny(`egress denied: ${d.sensitivity}-sensitivity cannot be materialized to a cloud vendor`)
  }

  const next: ContentItem = { ...item, state: to, ...(to === 'LegalHold' ? { legalHold: true } : {}) }
  const reason = `${item.state} → ${to}`
  opts.audit?.({ ts: Date.now(), itemId: item.id, from: item.state, to, ok: true, reason })
  return { ok: true, item: next, reason }
}

/** The happy path Ingested→Served (each step gated + audited). Stops at the first refused transition. */
export const SERVE_PATH: ContentState[] = ['Normalized', 'Extracted', 'Indexed', 'Served']
export function advanceToServed(item: ContentItem, opts: { audit?: AuditHook } = {}): TransitionResult {
  let cur = item
  for (const to of SERVE_PATH) {
    const r = transition(cur, to, opts)
    if (!r.ok) return r
    cur = r.item
  }
  return { ok: true, item: cur, reason: 'served' }
}
