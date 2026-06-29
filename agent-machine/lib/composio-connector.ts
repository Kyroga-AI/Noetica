/**
 * composio-connector.ts — wrap Composio tools as governed ConnectorSource instances.
 *
 * Composio provides 100+ enterprise integrations (GitHub, Slack, Asana, Notion, …) but
 * has NO governance model — all tools are equally trusted once an API key is present.
 *
 * This adapter routes every Composio execution through our governance layer:
 *   (1) AuthorizeEgress — scope-d EngagementPolicy gate (fail-closed on network calls)
 *   (2) ConnectorReceipt — tamper-evident SHA-256 audit record per run
 *   (3) A2A trust — Composio backend is a SPIFFE actor in the behavioral ledger
 *
 * Uses Composio's REST API directly (no SDK dep required), so it works today
 * without adding @composio/core to package.json. Install the SDK later if
 * you want strongly-typed tool discovery.
 *
 * API base: https://backend.composio.dev/api/v2
 * Docs:     https://docs.composio.dev/api-reference
 *
 * Tool naming convention: TOOLKIT_ACTION  e.g. GITHUB_SEARCH_REPOSITORIES
 */

import { createHash, randomBytes } from 'node:crypto'
import { checkActorGrant, recordOutcome, type GrantDecision } from './a2a-trust.js'
import { type ConnectorSource, type ConnectorDoc, type ConnectorReceipt, type ConnectorRun, type AuthorizeEgress } from './connector.js'

export const COMPOSIO_SPIFFE = 'spiffe://composio.dev/service'
const COMPOSIO_API = 'https://backend.composio.dev/api/v2'
const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex')

// ── REST client ───────────────────────────────────────────────────────────────

async function composioRequest(
  path: string,
  apiKey: string,
  method: 'GET' | 'POST' = 'GET',
  body?: unknown,
): Promise<unknown> {
  const res = await fetch(`${COMPOSIO_API}${path}`, {
    method,
    headers: {
      'x-api-key': apiKey,
      'content-type': 'application/json',
      'accept': 'application/json',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Composio ${method} ${path} → ${res.status}: ${text.slice(0, 200)}`)
  }
  return res.json()
}

// ── Tool discovery ────────────────────────────────────────────────────────────

export interface ComposioTool {
  slug: string
  name: string
  description?: string
  toolkit: string
  inputSchema?: Record<string, unknown>
}

/** List all available tools for a toolkit (e.g. 'github', 'slack'). */
export async function listComposioTools(toolkit: string, apiKey: string): Promise<ComposioTool[]> {
  const data = await composioRequest(`/actions?toolkitSlug=${encodeURIComponent(toolkit)}&limit=100`, apiKey) as {
    items?: Array<{ slug: string; name: string; description?: string; toolkit?: { slug: string }; inputParameters?: Record<string, unknown> }>
  }
  return (data.items ?? []).map((t) => ({
    slug: t.slug,
    name: t.name,
    description: t.description,
    toolkit: t.toolkit?.slug ?? toolkit,
    inputSchema: t.inputParameters,
  }))
}

// ── ConnectorSource factory ───────────────────────────────────────────────────

export interface ComposioConnectorOpts {
  /** Composio API key. Required. */
  apiKey: string
  /**
   * Connected account ID (from Composio dashboard) — links the execution to a
   * user's authenticated OAuth session for the target service.
   */
  connectedAccountId: string
  /** Text extraction hint: which field(s) of the result to treat as document text.
   *  Defaults to JSON.stringify of the full result. */
  textFields?: string[]
  /**
   * Trust floor override. Sensitive tools (e.g. GITHUB_CREATE_ISSUE) should pass
   * a higher floor than read-only tools (GITHUB_SEARCH_REPOSITORIES).
   */
  trustFloor?: number
}

/**
 * Create a governed ConnectorSource for a single Composio tool.
 *
 * Usage:
 *   const src = composioConnector('GITHUB_SEARCH_REPOSITORIES', opts)
 *   const run = await runConnector(src, { authorize, onReceipt })
 */
export function composioConnector(
  toolSlug: string,               // e.g. 'GITHUB_SEARCH_REPOSITORIES'
  params: Record<string, unknown>,
  opts: ComposioConnectorOpts,
): ConnectorSource {
  const [toolkit] = toolSlug.split('_')
  return {
    id: `composio-${toolSlug.toLowerCase()}-${randomBytes(4).toString('hex')}`,
    kind: `composio:${(toolkit ?? toolSlug).toLowerCase()}`,
    egress: true,                  // all Composio calls reach the network — scope-d gates this
    fetch: async (): Promise<Array<Omit<ConnectorDoc, 'fetchedAt'>>> => {
      const result = await composioRequest('/actions/execute', opts.apiKey, 'POST', {
        actionName: toolSlug,
        connectedAccountId: opts.connectedAccountId,
        input: params,
      }) as { result?: unknown; error?: string; successfull?: boolean }

      if (result.error) throw new Error(result.error)

      const text = opts.textFields
        ? extractFields(result.result, opts.textFields)
        : JSON.stringify(result.result, null, 2)

      return [{
        uri:   `composio://${(toolkit ?? toolSlug).toLowerCase()}/${toolSlug}`,
        title: toolSlug,
        text,
        mime:  'application/json',
      }]
    },
  }
}

function extractFields(obj: unknown, fields: string[]): string {
  if (!obj || typeof obj !== 'object') return String(obj ?? '')
  const parts: string[] = []
  for (const f of fields) {
    const v = (obj as Record<string, unknown>)[f]
    if (v !== undefined) parts.push(typeof v === 'string' ? v : JSON.stringify(v))
  }
  return parts.join('\n\n') || JSON.stringify(obj, null, 2)
}

// ── Governed batch runner ─────────────────────────────────────────────────────

export interface ComposioRunResult {
  toolSlug: string
  run: ConnectorRun
  decision: GrantDecision
}

/**
 * Run one or more Composio tools under full governance:
 *   1. A2A behavioral trust check (Composio backend as SPIFFE actor)
 *   2. Egress authorization (scope-d EngagementPolicy)
 *   3. Execution via Composio REST API
 *   4. ConnectorReceipt emission
 *
 * Returns a result per tool regardless of success/failure — never throws.
 */
export async function runComposioTools(
  calls: Array<{ toolSlug: string; params: Record<string, unknown> }>,
  opts: ComposioConnectorOpts,
  governance: {
    authorize?: AuthorizeEgress
    onReceipt?: (r: ConnectorReceipt) => void
  } = {},
): Promise<ComposioRunResult[]> {
  const { runConnector } = await import('./connector.js')
  const results: ComposioRunResult[] = []

  for (const call of calls) {
    const decision = checkActorGrant(COMPOSIO_SPIFFE, call.toolSlug, opts.trustFloor)
    if (!decision.valid) {
      recordOutcome(COMPOSIO_SPIFFE, { ok: false })
      // Synthesize a denial receipt so the attempt is still auditable
      const denialReceipt: ConnectorReceipt = {
        id: `conn-${randomBytes(8).toString('hex')}`,
        type: 'ConnectorReceipt',
        connectorId: `composio-${call.toolSlug.toLowerCase()}`,
        kind: `composio:${(call.toolSlug.split('_')[0] ?? call.toolSlug).toLowerCase()}`,
        egress: true,
        authorized: false,
        status: 'denied',
        docCount: 0,
        uris: [],
        contentHash: sha256(''),
        fetchedAt: new Date().toISOString(),
        reason: `A2A trust gate: ${decision.reason}`,
      }
      governance.onReceipt?.(denialReceipt)
      results.push({ toolSlug: call.toolSlug, run: { receipt: denialReceipt, docs: [] }, decision })
      continue
    }

    const src = composioConnector(call.toolSlug, call.params, opts)
    try {
      const run = await runConnector(src, { authorize: governance.authorize, onReceipt: governance.onReceipt })
      recordOutcome(COMPOSIO_SPIFFE, { ok: run.receipt.status === 'ok', up: true })
      results.push({ toolSlug: call.toolSlug, run, decision })
    } catch (e) {
      recordOutcome(COMPOSIO_SPIFFE, { ok: false, up: true })
      results.push({
        toolSlug: call.toolSlug,
        run: { receipt: { id: `conn-${randomBytes(8).toString('hex')}`, type: 'ConnectorReceipt', connectorId: src.id, kind: src.kind, egress: true, authorized: true, status: 'error', docCount: 0, uris: [], contentHash: sha256(''), fetchedAt: new Date().toISOString(), reason: e instanceof Error ? e.message : String(e) }, docs: [] },
        decision,
      })
    }
  }
  return results
}

// ── EngagementPolicy template ─────────────────────────────────────────────────
// Add to your scope-d policy store to authorize Composio egress.
// Adjust authorizedTargets to the specific Composio-connected services you use.

export const COMPOSIO_POLICY_TEMPLATE = {
  policyId: 'composio-default',
  name: 'Composio enterprise connectors',
  authorizedTargets: [
    'backend.composio.dev',
    // Add the downstream service hostnames you actually use:
    // 'api.github.com', 'slack.com', 'asana.com', 'linear.app', 'notion.so', …
  ],
  authorizedModes: ['read', 'write'],
  approvalRules: [
    { actionClass: 'network_call',  requiredGate: 'none' },
    { actionClass: 'data_mutation', requiredGate: 'none' },   // tighten to 'human' for write ops
  ],
  blockedActions: [],
}
