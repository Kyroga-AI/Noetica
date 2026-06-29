/**
 * remote-mcp-peer.ts — zero-trust connections to REMOTE MCP servers over SSE or StreamableHTTP.
 *
 * Extends federated-mcp.ts (which handles stdio peers) to cover cloud-hosted MCP endpoints:
 *   SSE              — mcp.asana.com/sse, mcp.linear.app/mcp, api.greptile.com/mcp, …
 *   StreamableHTTP   — api.githubcopilot.com/mcp/, gitlab.com/api/v4/mcp, …
 *
 * SAME zero-trust model as federated-mcp: every connection is a SPIFFE identity in the A2A
 * ledger, every tool call is gated by checkActorGrant, and every outcome feeds the behavioral
 * score. The network token (Bearer / PAT) never bypasses trust — it only authenticates the
 * transport; A2A trust is a separate, behavioral gate on top.
 *
 * Two extra guards specific to remote peers:
 *   (1) allowedHosts — the connecting URL's hostname must match the declared set; a
 *       misconfigured or hijacked URL cannot silently reach a different host.
 *   (2) Timeout — connect + tool-list must resolve within CONNECT_TIMEOUT_MS; hung remote
 *       peers record an uptime-down outcome and don't block the server.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { checkActorGrant, recordOutcome, type GrantDecision } from './a2a-trust.js'

const CONNECT_TIMEOUT_MS = 12_000

export type RemoteTransport = 'sse' | 'http'

export interface RemotePeerConfig {
  /** SPIFFE-style identity: spiffe://github.mcp/copilot, spiffe://asana.mcp/service, … */
  spiffeId: string
  /** Full URL of the MCP endpoint. */
  url: string
  /** 'sse' (legacy) or 'http' (StreamableHTTP — preferred for new servers). */
  transport: RemoteTransport
  /** Bearer token or PAT injected as Authorization header. Never logged. */
  token?: string
  /** Additional headers (e.g. X-Api-Version). */
  headers?: Record<string, string>
  /**
   * Allowed hostnames — the URL's hostname MUST match one of these.
   * Prevents a misconfigured URL from connecting to an unintended host.
   * Defaults to [ new URL(url).hostname ].
   */
  allowedHosts?: string[]
  /** Trust floor override for sensitive peers (default: TRUST_FLOOR = 0.45). */
  trustFloor?: number
}

interface RemotePeerHandle {
  config: RemotePeerConfig
  client: Client
  transport: SSEClientTransport | StreamableHTTPClientTransport
  tools: string[]
}

const remotePeers = new Map<string, RemotePeerHandle>()

function buildHeaders(cfg: RemotePeerConfig): Record<string, string> {
  const h: Record<string, string> = { ...(cfg.headers ?? {}) }
  if (cfg.token) h['authorization'] = `Bearer ${cfg.token}`
  return h
}

function assertHost(cfg: RemotePeerConfig): void {
  const hostname = new URL(cfg.url).hostname
  const allowed = cfg.allowedHosts ?? [hostname]
  if (!allowed.includes(hostname)) {
    throw new Error(`[remote-mcp] host "${hostname}" not in allowedHosts for ${cfg.spiffeId}`)
  }
}

function timeout<T>(ms: number, p: Promise<T>): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms)),
  ])
}

/** Connect to a remote MCP server. Idempotent — returns the existing handle if already connected. */
export async function connectRemotePeer(cfg: RemotePeerConfig): Promise<{ spiffeId: string; tools: string[] }> {
  const existing = remotePeers.get(cfg.spiffeId)
  if (existing) return { spiffeId: cfg.spiffeId, tools: existing.tools }

  assertHost(cfg)

  const url = new URL(cfg.url)
  const headers = buildHeaders(cfg)

  const transport: SSEClientTransport | StreamableHTTPClientTransport =
    cfg.transport === 'sse'
      ? new SSEClientTransport(url, { requestInit: { headers } })
      : new StreamableHTTPClientTransport(url, { requestInit: { headers } })

  const client = new Client({ name: 'noetica', version: '0.4.21' }, { capabilities: {} })

  try {
    await timeout(CONNECT_TIMEOUT_MS, client.connect(transport))
    const list = await timeout(CONNECT_TIMEOUT_MS, client.listTools())
    const tools = (list.tools ?? []).map((t) => t.name)
    remotePeers.set(cfg.spiffeId, { config: cfg, client, transport, tools })
    recordOutcome(cfg.spiffeId, { up: true })
    console.log(`[remote-mcp] connected ${cfg.spiffeId} (${tools.length} tools) via ${cfg.transport}`)
    return { spiffeId: cfg.spiffeId, tools }
  } catch (e) {
    recordOutcome(cfg.spiffeId, { up: false })
    try { await client.close() } catch { /* */ }
    throw new Error(`[remote-mcp] failed to connect ${cfg.spiffeId}: ${e instanceof Error ? e.message : String(e)}`)
  }
}

export interface RemotePeerCallResult { ok: boolean; decision: GrantDecision; result?: unknown; error?: string }

/**
 * Call a tool on a connected remote peer.
 * Gated by A2A behavioral trust (checkActorGrant), outcome fed back to the ledger.
 * The network token is never consulted here — trust is behavioral, not credential-based.
 */
export async function callRemotePeerTool(
  spiffeId: string,
  toolName: string,
  args?: Record<string, unknown>,
  floor?: number,
): Promise<RemotePeerCallResult> {
  const h = remotePeers.get(spiffeId)
  if (!h) throw new Error(`remote peer ${spiffeId} not connected — call connectRemotePeer first`)

  const decision = checkActorGrant(spiffeId, toolName, floor ?? h.config.trustFloor)
  if (!decision.valid) {
    recordOutcome(spiffeId, { ok: false })
    return { ok: false, decision, error: decision.reason }
  }

  try {
    const result = await timeout(
      30_000,
      h.client.callTool({ name: toolName, arguments: args ?? {} }),
    )
    const isError = Boolean((result as { isError?: boolean }).isError)
    recordOutcome(spiffeId, { ok: !isError, up: true })
    return { ok: !isError, decision, result }
  } catch (e) {
    recordOutcome(spiffeId, { ok: false, up: false })
    return { ok: false, decision, error: e instanceof Error ? e.message : String(e) }
  }
}

export function connectedRemotePeers(): Array<{ spiffeId: string; url: string; transport: RemoteTransport; tools: string[] }> {
  return [...remotePeers.values()].map((h) => ({
    spiffeId: h.config.spiffeId,
    url: h.config.url,
    transport: h.config.transport,
    tools: h.tools,
  }))
}

export async function disconnectRemotePeer(spiffeId: string): Promise<void> {
  const h = remotePeers.get(spiffeId)
  if (!h) return
  remotePeers.delete(spiffeId)
  try { await h.client.close() } catch { /* */ }
}
