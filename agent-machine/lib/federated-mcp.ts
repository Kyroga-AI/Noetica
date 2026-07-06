/**
 * federated-mcp.ts — connect to a peer framework's MCP server (AIWG / Ruflo / …) as a FEDERATED A2A actor.
 *
 * The agent-machine sidecar (full subprocess access, unlike the sandboxed webview) spawns the peer's MCP server
 * over stdio and speaks MCP to it. EVERY tool call is gated by the peer's behavioral trust + TrustOps authority
 * (a2a-trust.checkActorGrant) and each outcome feeds the ledger — so the peer earns trust slowly, loses it
 * instantly, and sensitive capabilities demand a higher floor. This is "AIWG over our A2A zero-trust", not bare
 * MCP. Egress (scope-d) composes separately on the action path.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { checkActorGrant, recordOutcome, type GrantDecision } from './a2a-trust.js'

interface PeerHandle { spiffeId: string; client: Client; transport: StdioClientTransport; tools: string[] }
const peers = new Map<string, PeerHandle>()

/** Spawn + connect a federated peer's MCP server. Reachability is itself a trust signal (up/down). */
export async function connectPeer(spiffeId: string, command: string, args: string[], env?: Record<string, string>): Promise<{ spiffeId: string; tools: string[] }> {
  const existing = peers.get(spiffeId)
  if (existing) return { spiffeId, tools: existing.tools }
  const transport = new StdioClientTransport({ command, args, env: env ? { ...process.env, ...env } as Record<string, string> : undefined })
  const client = new Client({ name: 'noetica', version: '0.4.19' }, { capabilities: {} })
  try {
    await client.connect(transport)
    const list = await client.listTools()
    const tools = (list.tools ?? []).map((t) => t.name)
    peers.set(spiffeId, { spiffeId, client, transport, tools })
    recordOutcome(spiffeId, { up: true })
    return { spiffeId, tools }
  } catch (e) {
    recordOutcome(spiffeId, { up: false })
    try { await client.close() } catch { /* */ }
    throw e
  }
}

export interface PeerCallResult { ok: boolean; decision: GrantDecision; result?: unknown; error?: string }
/** Call a tool on a connected peer — GATED by A2A behavioral trust, with the outcome fed back. */
export async function callPeerTool(spiffeId: string, toolName: string, args?: Record<string, unknown>, floor?: number): Promise<PeerCallResult> {
  const h = peers.get(spiffeId)
  if (!h) throw new Error(`peer ${spiffeId} not connected`)
  const decision = checkActorGrant(spiffeId, toolName, floor)
  if (!decision.valid) { recordOutcome(spiffeId, { ok: false }); return { ok: false, decision, error: decision.reason } }
  try {
    const result = await h.client.callTool({ name: toolName, arguments: args ?? {} })
    const isError = Boolean((result as { isError?: boolean }).isError)
    recordOutcome(spiffeId, { ok: !isError, up: true })
    return { ok: !isError, decision, result }
  } catch (e) {
    recordOutcome(spiffeId, { ok: false, up: false })
    return { ok: false, decision, error: e instanceof Error ? e.message : 'peer call failed' }
  }
}

export function connectedPeers(): Array<{ spiffeId: string; tools: string[] }> {
  return [...peers.values()].map((h) => ({ spiffeId: h.spiffeId, tools: h.tools }))
}

export async function disconnectPeer(spiffeId: string): Promise<void> {
  const h = peers.get(spiffeId)
  if (!h) return
  peers.delete(spiffeId)
  try { await h.client.close() } catch { /* */ }
}
