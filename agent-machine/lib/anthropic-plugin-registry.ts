/**
 * anthropic-plugin-registry.ts — auto-register Anthropic external plugins under zero-trust governance.
 *
 * Reads a plugin manifest (the .mcp.json format from claude-plugins-official/external_plugins)
 * and connects each server through the appropriate transport, routing every connection through
 * either federated-mcp (stdio subprocess) or remote-mcp-peer (SSE / StreamableHTTP remote).
 *
 * SPIFFE IDs follow the pattern:
 *   stdio remote:   spiffe://plugin.anthropic/<name>
 *   SSE/HTTP remote: spiffe://<hostname>/mcp/<name>
 *
 * Every plugin starts at the standard external-actor trust floor (0.4) and earns or loses
 * trust based on observed behavior — the OAuth token/PAT does NOT grant trust, it only
 * authenticates the transport.
 *
 * Manifest format (two variants seen in the wild):
 *   Variant A — top-level key = plugin name, value = { type, url, headers? }
 *   Variant B — { mcpServers: { <name>: { command, args, env? } } }
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { connectPeer, callPeerTool, type PeerCallResult } from './federated-mcp.js'
import { connectRemotePeer, callRemotePeerTool, type RemotePeerCallResult, type RemoteTransport } from './remote-mcp-peer.js'

// ── Plugin manifest types ──────────────────────────────────────────────────────

interface RemoteEntry { type: 'sse' | 'http'; url: string; headers?: Record<string, string> }
interface StdioEntry  { command: string; args: string[]; env?: Record<string, string> }
type McpEntry = RemoteEntry | StdioEntry

function isRemote(e: McpEntry): e is RemoteEntry { return 'url' in e }

/** Parsed representation of one MCP server from a .mcp.json manifest. */
export interface PluginServer {
  name: string
  spiffeId: string
  kind: 'remote' | 'stdio'
  // remote
  url?: string
  transport?: RemoteTransport
  headers?: Record<string, string>
  // stdio
  command?: string
  args?: string[]
  env?: Record<string, string>
}

// ── Manifest parsing ──────────────────────────────────────────────────────────

/** Parse a .mcp.json buffer into zero or more PluginServer descriptors. */
export function parsePluginManifest(raw: string | Record<string, unknown>): PluginServer[] {
  const obj = typeof raw === 'string' ? JSON.parse(raw) as Record<string, unknown> : raw
  const servers: PluginServer[] = []

  // Variant B: { mcpServers: { name: { command, args } } }
  if (obj['mcpServers'] && typeof obj['mcpServers'] === 'object') {
    for (const [name, entry] of Object.entries(obj['mcpServers'] as Record<string, McpEntry>)) {
      servers.push(toPluginServer(name, entry))
    }
    return servers
  }

  // Variant A: { name: { type, url } } — skip meta keys that aren't server entries
  for (const [key, val] of Object.entries(obj)) {
    if (!val || typeof val !== 'object') continue
    const e = val as McpEntry
    if (isRemote(e) && e.url) servers.push(toPluginServer(key, e))
    else if ('command' in e && e.command) servers.push(toPluginServer(key, e))
  }
  return servers
}

function toPluginServer(name: string, entry: McpEntry): PluginServer {
  if (isRemote(entry)) {
    const hostname = new URL(entry.url).hostname
    return {
      name,
      spiffeId: `spiffe://${hostname}/mcp/${name}`,
      kind: 'remote',
      url: entry.url,
      transport: (entry.type === 'sse' ? 'sse' : 'http') as RemoteTransport,
      headers: entry.headers,
    }
  }
  return {
    name,
    spiffeId: `spiffe://plugin.anthropic/${name}`,
    kind: 'stdio',
    command: entry.command,
    args: entry.args ?? [],
    env: entry.env,
  }
}

// ── Registry ─────────────────────────────────────────────────────────────────

const registry = new Map<string, PluginServer>()

/**
 * Register a plugin from a parsed manifest. Does NOT connect — call connectPlugin() separately
 * so callers control when network connections are established.
 */
export function registerPlugin(server: PluginServer): void {
  registry.set(server.spiffeId, server)
}

/** Register all plugins parsed from a manifest file on disk. */
export function registerPluginsFromFile(manifestPath: string): PluginServer[] {
  const raw = fs.readFileSync(manifestPath, 'utf8')
  const servers = parsePluginManifest(raw)
  servers.forEach(registerPlugin)
  return servers
}

/**
 * Register plugins from a directory of per-plugin folders, each containing a .mcp.json.
 * Mirrors the layout of claude-plugins-official/external_plugins/.
 */
export function registerPluginsFromDir(dir: string): PluginServer[] {
  const results: PluginServer[] = []
  if (!fs.existsSync(dir)) return results
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const manifestPath = path.join(dir, entry.name, '.mcp.json')
    if (!fs.existsSync(manifestPath)) continue
    try {
      const servers = registerPluginsFromFile(manifestPath)
      results.push(...servers)
    } catch (e) {
      console.warn(`[plugin-registry] could not parse ${manifestPath}: ${e instanceof Error ? e.message : e}`)
    }
  }
  return results
}

export function registeredPlugins(): PluginServer[] { return [...registry.values()] }

// ── Connect + call ────────────────────────────────────────────────────────────

/** Connect a registered plugin. Returns the list of tools exposed by the server. */
export async function connectPlugin(spiffeId: string, tokenEnv?: Record<string, string>): Promise<{ spiffeId: string; tools: string[] }> {
  const s = registry.get(spiffeId)
  if (!s) throw new Error(`plugin ${spiffeId} not registered`)

  if (s.kind === 'remote') {
    // Resolve token from the provided env map (keys are env-var names like GITHUB_PERSONAL_ACCESS_TOKEN)
    const token = tokenEnv ? resolveToken(s.headers ?? {}, tokenEnv) : undefined
    const resolvedHeaders = resolveHeaders(s.headers ?? {}, tokenEnv ?? {})
    return connectRemotePeer({
      spiffeId: s.spiffeId,
      url: s.url!,
      transport: s.transport ?? 'http',
      token,
      headers: resolvedHeaders,
    })
  }

  // stdio
  const env = resolveEnv(s.env ?? {}, tokenEnv ?? {})
  return connectPeer(s.spiffeId, s.command!, s.args ?? [], Object.keys(env).length ? env : undefined)
}

export type PluginCallResult = PeerCallResult | RemotePeerCallResult

/** Call a tool on a connected plugin. Trust-gated regardless of transport. */
export async function callPluginTool(
  spiffeId: string,
  toolName: string,
  args?: Record<string, unknown>,
  floor?: number,
): Promise<PluginCallResult> {
  const s = registry.get(spiffeId)
  if (!s) throw new Error(`plugin ${spiffeId} not registered`)
  return s.kind === 'remote'
    ? callRemotePeerTool(spiffeId, toolName, args, floor)
    : callPeerTool(spiffeId, toolName, args, floor)
}

// ── Token resolution ──────────────────────────────────────────────────────────
// Headers in the manifest may contain ${ENV_VAR} placeholders.

function resolveToken(headers: Record<string, string>, env: Record<string, string>): string | undefined {
  const auth = Object.values(headers).find((v) => v.startsWith('Bearer ${'))
  if (!auth) return undefined
  const varName = auth.match(/\$\{([^}]+)\}/)?.[1]
  return varName ? (env[varName] ?? process.env[varName]) : undefined
}

function resolveHeaders(headers: Record<string, string>, env: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(headers)) {
    out[k] = v.replace(/\$\{([^}]+)\}/g, (_, name: string) => env[name] ?? process.env[name] ?? '')
  }
  return out
}

function resolveEnv(template: Record<string, string>, supplied: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(template)) {
    out[k] = v.replace(/\$\{([^}]+)\}/g, (_, name: string) => supplied[name] ?? process.env[name] ?? '')
  }
  return out
}
