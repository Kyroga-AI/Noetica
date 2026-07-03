/**
 * vendor-cache.ts — Layer 3 of the content model: vendor materialization + cache management.
 *
 * The content-lifecycle's VendorMaterialized branch: take a canonical content item (blob-store) and
 * create a file handle in a cloud model vendor's Files API so the model can reference it. Per the diagram:
 *   Gemini Files API = TTL cache · Claude Files API = durable cache · OpenAI File Handles = durable cache.
 * A Vendor Cache Manager runs GC (TTL) + budgets. Materialization is EGRESS — gated by the isolation policy
 * (only low-sensitivity content may leave the device), so a secret can never be uploaded to a cloud vendor.
 * TTL expiry maps to the lifecycle's ExpiredVendorCache (re-materializable from canonical).
 */
import { decideIsolation } from './isolation-policy.js'

export type Vendor = 'gemini' | 'claude' | 'openai'

export const VENDOR_CACHE: Record<Vendor, { kind: 'ttl' | 'durable'; ttlMs?: number }> = {
  gemini: { kind: 'ttl', ttlMs: 48 * 3600_000 }, // Gemini Files API — 48h TTL
  claude: { kind: 'durable' },
  openai: { kind: 'durable' },
}

export interface VendorHandle {
  id: string
  vendor: Vendor
  fileId: string      // the vendor's file-handle id
  contentId: string   // the canonical content item (blob-store) this materializes
  createdAt: number
  expiresAt?: number  // set for TTL vendors
  state: 'active' | 'expired'
}

export interface MaterializeInput {
  contentId: string
  vendor: Vendor
  content?: string
  labels?: string[]
  now?: number
  upload?: (vendor: Vendor, contentId: string) => string // inject the real Files-API upload; default is a stub id
}
export interface MaterializeResult { ok: boolean; handle?: VendorHandle; reason: string }

/** Materialize a canonical content item to a vendor Files API — gated by the isolation policy (egress). */
export function materialize(input: MaterializeInput): MaterializeResult {
  const d = decideIsolation({ content: input.content, labels: input.labels })
  if (!d.egressAllowed) return { ok: false, reason: `egress denied: ${d.sensitivity}-sensitivity cannot be materialized to ${input.vendor}` }
  const cfg = VENDOR_CACHE[input.vendor]
  const now = input.now ?? Date.now()
  const fileId = input.upload ? input.upload(input.vendor, input.contentId) : `${input.vendor}-file:${input.contentId}`
  const handle: VendorHandle = {
    id: `vh:${input.vendor}:${input.contentId}`,
    vendor: input.vendor,
    fileId,
    contentId: input.contentId,
    createdAt: now,
    expiresAt: cfg.kind === 'ttl' ? now + (cfg.ttlMs ?? 0) : undefined,
    state: 'active',
  }
  return { ok: true, handle, reason: `materialized to ${input.vendor} (${cfg.kind} cache)` }
}

/** TTL/GC — expire TTL handles past their expiry (→ ExpiredVendorCache); durable handles survive. */
export function gc(handles: VendorHandle[], now = Date.now()): { kept: VendorHandle[]; expired: VendorHandle[] } {
  const kept: VendorHandle[] = []
  const expired: VendorHandle[] = []
  for (const h of handles) {
    if (h.expiresAt != null && now >= h.expiresAt) expired.push({ ...h, state: 'expired' })
    else kept.push(h)
  }
  return { kept, expired }
}

/** Budget — cap active handles per vendor, evicting the oldest (cheapest to re-materialize). */
export function enforceBudget(handles: VendorHandle[], maxPerVendor = 100): { kept: VendorHandle[]; evicted: VendorHandle[] } {
  const byVendor = new Map<Vendor, VendorHandle[]>()
  for (const h of handles) { const a = byVendor.get(h.vendor) ?? []; a.push(h); byVendor.set(h.vendor, a) }
  const kept: VendorHandle[] = []
  const evicted: VendorHandle[] = []
  for (const list of byVendor.values()) {
    const sorted = [...list].sort((a, b) => b.createdAt - a.createdAt) // newest first
    kept.push(...sorted.slice(0, maxPerVendor))
    evicted.push(...sorted.slice(maxPerVendor))
  }
  return { kept, evicted }
}
