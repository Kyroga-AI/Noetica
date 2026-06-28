/**
 * connector.ts — the governed connector framework. Onyx ships 40+ connectors (Slack/GitHub/GDrive/…); the
 * differentiator only we can offer is that every connector run is GOVERNED and EVIDENCE-EMITTING:
 *   (1) egress is AUTHORIZED before any fetch (fail-closed — a network connector is denied unless a policy/
 *       authorize hook approves it, matching scope-d's local-first posture);
 *   (2) every run emits a tamper-evident `ConnectorReceipt` (content hash + provenance) for the evidence fabric;
 *   (3) it yields normalized `ConnectorDoc[]` ready for chunking / auto-KG (compose with lib/auto-kg).
 *
 * Noetica already had ad-hoc ingest surfaces (repo-ingest, federated-mcp, mail-bridge, chat-import) but no
 * unified contract that governs egress + emits provenance per fetch. This is that contract.
 *
 * Pure + model-free. The egress authorize check and the receipt sink are INJECTED hooks (default fail-closed on
 * egress; default no-op sink), so the core is fully testable offline and decoupled from scope-d / the evidence
 * fabric — the server wires the real hooks.
 */

import { createHash, randomBytes } from 'node:crypto'

export interface ConnectorDoc { uri: string; title: string; text: string; mime?: string; fetchedAt: string }

export interface ConnectorSource {
  id: string                                            // connector instance id
  kind: string                                          // 'manual' | 'web' | 'github' | 'gdrive' | 'slack' | …
  egress: boolean                                       // does fetching reach the network? (gates authorization)
  fetch: () => Promise<Array<Omit<ConnectorDoc, 'fetchedAt'>>>
}

export interface ConnectorReceipt {
  id: string
  type: 'ConnectorReceipt'
  connectorId: string
  kind: string
  egress: boolean
  authorized: boolean
  scope?: string
  status: 'ok' | 'denied' | 'error'
  docCount: number
  uris: string[]
  contentHash: string      // sha256 over the fetched docs — tamper-evident provenance
  fetchedAt: string
  reason?: string          // denial / error detail
}

export interface ConnectorRun { receipt: ConnectorReceipt; docs: ConnectorDoc[] }

/** Egress authorization decision. The real impl consults scope-d's EngagementPolicy; the default is fail-closed. */
export type AuthorizeEgress = (s: { connectorId: string; kind: string; egress: boolean }) => { allowed: boolean; scope?: string; reason?: string }

/** Default: local (non-egress) connectors are allowed in CITIZEN_FOG; any network egress is DENIED unless an
 *  explicit authorize hook (scope-d policy) approves it. Fail-closed — egress is never silent. */
const defaultAuthorize: AuthorizeEgress = (s) =>
  s.egress ? { allowed: false, reason: 'egress not authorized — supply an authorize hook backed by a scope-d EngagementPolicy' } : { allowed: true, scope: 'CITIZEN_FOG' }

const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex')

/**
 * Run a connector under governance: authorize egress → fetch → emit a tamper-evident receipt. Never throws — a
 * denied or failed run returns an empty doc set with a receipt explaining why (evidence of the attempt).
 */
export async function runConnector(
  source: ConnectorSource,
  opts: { authorize?: AuthorizeEgress; now?: () => string; onReceipt?: (r: ConnectorReceipt) => void } = {},
): Promise<ConnectorRun> {
  const authorize = opts.authorize ?? defaultAuthorize
  const now = opts.now ?? (() => new Date().toISOString())
  const base = { id: `conn-${randomBytes(8).toString('hex')}`, type: 'ConnectorReceipt' as const, connectorId: source.id, kind: source.kind, egress: source.egress, fetchedAt: now() }

  const decision = authorize({ connectorId: source.id, kind: source.kind, egress: source.egress })
  if (!decision.allowed) {
    const receipt: ConnectorReceipt = { ...base, authorized: false, status: 'denied', docCount: 0, uris: [], contentHash: sha256(''), reason: decision.reason }
    opts.onReceipt?.(receipt)
    return { receipt, docs: [] }
  }

  let docs: ConnectorDoc[] = []
  try {
    const fetched = await source.fetch()
    docs = fetched.map((d) => ({ ...d, fetchedAt: base.fetchedAt }))
  } catch (e) {
    const receipt: ConnectorReceipt = { ...base, authorized: true, scope: decision.scope, status: 'error', docCount: 0, uris: [], contentHash: sha256(''), reason: e instanceof Error ? e.message : String(e) }
    opts.onReceipt?.(receipt)
    return { receipt, docs: [] }
  }

  const contentHash = sha256(docs.map((d) => `${d.uri}\n${d.text}`).join('\n---\n'))
  const receipt: ConnectorReceipt = {
    ...base, authorized: true, scope: decision.scope, status: 'ok',
    docCount: docs.length, uris: docs.map((d) => d.uri).slice(0, 200), contentHash,
  }
  opts.onReceipt?.(receipt)
  return { receipt, docs }
}

// ── reference connectors ─────────────────────────────────────────────────────────────────────────────────
/** Manual / paste / upload connector — local, no egress. The offline reference impl + the route's default. */
export function manualConnector(id: string, docs: Array<{ uri?: string; title?: string; text: string }>): ConnectorSource {
  return {
    id, kind: 'manual', egress: false,
    fetch: async () => docs.filter((d) => d.text && d.text.trim()).map((d, i) => ({ uri: d.uri ?? `manual://${id}/${i}`, title: d.title ?? `doc ${i + 1}`, text: d.text, mime: 'text/plain' })),
  }
}

/** Wrap any async fetch fn as a connector (e.g. a network source); pass egress:true so it must be authorized. */
export function functionConnector(id: string, kind: string, egress: boolean, fetch: ConnectorSource['fetch']): ConnectorSource {
  return { id, kind, egress, fetch }
}
