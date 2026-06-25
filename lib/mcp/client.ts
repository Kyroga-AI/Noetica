/**
 * McpClientManager — manages connections to one or many MCP servers.
 *
 * Transport support:
 *   • SSE   — uses @modelcontextprotocol/sdk SSEClientTransport; works in
 *             both browser (dev) and Tauri (same WebView fetch/EventSource).
 *   • stdio — spawns the server via tauri-plugin-shell and wires a custom
 *             JSON-RPC readline transport. Only active when isTauri() === true;
 *             gracefully unavailable in browser dev mode.
 *
 * The manager is a plain-JS singleton (not React). React state lives in
 * useMcp.ts which subscribes to change callbacks here.
 */

import type { McpServerConfig, McpServerState, McpTool, McpResource, McpToolResult, McpToolCall } from '@/lib/types/mcp'
import { isTauri } from '@/lib/tauri/bridge'

// ─── Minimal SDK shim types ───────────────────────────────────────────────────

// We import the SDK lazily to avoid breaking the static export build when the
// package isn't installed. If the import fails, SSE connections just silently
// fail with an error status.

// eslint-disable-next-line
type AnyClient = any
// eslint-disable-next-line
type AnyTransport = any

async function makeSdkClient(): Promise<{ Client: new (info: object, opts: object) => AnyClient } | null> {
  try {
    // eslint-disable-next-line
    return await import('@modelcontextprotocol/sdk/client/index.js' as string) as any
  } catch {
    return null
  }
}

async function makeSseTransport(url: string, headers?: Record<string, string>): Promise<AnyTransport | null> {
  try {
    // eslint-disable-next-line
    const mod: any = await import('@modelcontextprotocol/sdk/client/sse.js' as string)
    const endpoint = new URL(url)
    // SSEClientTransport in SDK 1.x accepts (url, opts) or (url)
    return new mod.SSEClientTransport(endpoint, headers ? { requestInit: { headers } } : undefined)
  } catch {
    return null
  }
}

// ─── Tauri stdio transport ────────────────────────────────────────────────────

async function makeTauriStdioTransport(config: McpServerConfig): Promise<AnyTransport | null> {
  if (!isTauri() || !config.command) return null
  try {
    // eslint-disable-next-line
    const shellMod: any = await import(/* webpackIgnore: true */ '@tauri-apps/plugin-shell' as string)
    const cmd = shellMod.Command.create(config.command, config.args ?? [], {
      env: config.env ?? {},
    })

    // Callbacks set by the MCP Client
    let onMessage: ((msg: object) => void) | undefined
    let onClose: (() => void) | undefined
    let onError: ((e: Error) => void) | undefined

    // eslint-disable-next-line
    let child: any = null
    let buffer = ''

    return {
      set onmessage(fn: (msg: object) => void) { onMessage = fn },
      set onclose(fn: () => void) { onClose = fn },
      set onerror(fn: (e: Error) => void) { onError = fn },

      async start() {
        child = await cmd.spawn()
        // stdout: accumulate lines, parse JSON-RPC
        child.stdout.on('data', (line: string) => {
          buffer += line
          const parts = buffer.split('\n')
          buffer = parts.pop() ?? ''
          for (const part of parts) {
            const trimmed = part.trim()
            if (!trimmed) continue
            try {
              onMessage?.(JSON.parse(trimmed))
            } catch { /* skip malformed */ }
          }
        })
        child.on('close', () => onClose?.())
        child.stderr.on('data', (d: string) => {
          onError?.(new Error(`MCP stderr: ${d}`))
        })
      },

      async send(message: object) {
        if (!child) throw new Error('Transport not started')
        await child.write(JSON.stringify(message) + '\n')
      },

      async close() {
        try { await child?.kill() } catch { /* ignore */ }
        child = null
      },
    }
  } catch {
    return null
  }
}

// ─── McpClientManager ─────────────────────────────────────────────────────────

type StateListener = (states: McpServerState[]) => void

class McpClientManager {
  private states = new Map<string, McpServerState>()
  private clients = new Map<string, AnyClient>()
  private configs = new Map<string, McpServerConfig>()   // kept so callTool can resolve a federated peer's SPIFFE id
  private listeners = new Set<StateListener>()

  // ── Subscriptions ────────────────────────────────────────────────────────

  subscribe(fn: StateListener): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private notify() {
    const all = this.getStates()
    this.listeners.forEach((fn) => fn(all))
  }

  // ── State helpers ────────────────────────────────────────────────────────

  getStates(): McpServerState[] {
    return Array.from(this.states.values())
  }

  getState(id: string): McpServerState | undefined {
    return this.states.get(id)
  }

  private setState(id: string, patch: Partial<McpServerState>) {
    const existing = this.states.get(id)
    if (!existing) return
    this.states.set(id, { ...existing, ...patch })
    this.notify()
  }

  // ── Connect ──────────────────────────────────────────────────────────────

  async connect(config: McpServerConfig): Promise<void> {
    // Disconnect existing connection for this server if any
    await this.disconnect(config.id)
    this.configs.set(config.id, config)   // remember the config (federated peers carry a SPIFFE id for callTool)

    const initialState: McpServerState = {
      config,
      status: 'connecting',
      tools: [],
      resources: [],
    }
    this.states.set(config.id, initialState)
    this.notify()

    try {
      const sdkMod = await makeSdkClient()
      if (!sdkMod) throw new Error('@modelcontextprotocol/sdk not installed')

      let transport: AnyTransport | null = null
      if (config.transport === 'sse') {
        if (!config.url) throw new Error('SSE transport requires a URL')
        transport = await makeSseTransport(config.url, config.headers)
      } else if (config.transport === 'stdio') {
        transport = await makeTauriStdioTransport(config)
      }
      if (!transport) throw new Error(`Could not create ${config.transport} transport`)

      const client: AnyClient = new sdkMod.Client(
        { name: 'noetica', version: '1.0.0' },
        { capabilities: { tools: {}, resources: {} } }
      )

      await client.connect(transport)

      // Fetch tools
      let tools: McpTool[] = []
      try {
        const resp = await client.listTools()
        tools = (resp.tools ?? []).map((t: { name: string; description?: string; inputSchema?: object }) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema ?? {},
          serverId: config.id,
          serverName: config.name,
        }))
      } catch { /* server may not support tools */ }

      // Fetch resources
      let resources: McpResource[] = []
      try {
        const resp = await client.listResources()
        resources = (resp.resources ?? []).map((r: { uri: string; name?: string; description?: string; mimeType?: string }) => ({
          uri: r.uri,
          name: r.name,
          description: r.description,
          mimeType: r.mimeType,
          serverId: config.id,
        }))
      } catch { /* server may not support resources */ }

      this.clients.set(config.id, client)
      this.setState(config.id, {
        status: 'connected',
        tools,
        resources,
        connectedAt: new Date().toISOString(),
        serverInfo: client.getServerCapabilities?.()?.serverInfo ?? undefined,
      })
    } catch (e) {
      this.setState(config.id, {
        status: 'error',
        error: e instanceof Error ? e.message : String(e),
      })
    }
  }

  // ── Disconnect ───────────────────────────────────────────────────────────

  async disconnect(id: string): Promise<void> {
    const client = this.clients.get(id)
    if (client) {
      try { await client.close() } catch { /* ignore */ }
      this.clients.delete(id)
    }
    const existing = this.states.get(id)
    if (existing) {
      this.setState(id, { status: 'disconnected', tools: [], resources: [], error: undefined })
    }
  }

  // ── Remove ───────────────────────────────────────────────────────────────

  async remove(id: string): Promise<void> {
    await this.disconnect(id)
    this.states.delete(id)
    this.notify()
  }

  // ── Tool call ────────────────────────────────────────────────────────────

  async callTool(call: McpToolCall): Promise<McpToolResult> {
    const client = this.clients.get(call.serverId)
    if (!client) throw new Error(`Server ${call.serverId} not connected`)
    // Zero-trust grant gate (A2A). A FEDERATED PEER (AIWG/Ruflo/Gas Town — has a SPIFFE id) is gated by its
    // behavioral TRUST + authority status (checkActorGrant); a plain local server keeps the session grant path.
    // Either way the call never bypasses the A2A zero-trust layer.
    const cfg = this.configs.get(call.serverId)
    const { checkToolGrant, checkActorGrant, recordActorOutcome } = await import('@/lib/a2a/grantCheck')
    const peer = cfg?.spiffeId
    const verdict = peer ? checkActorGrant(peer, call.toolName) : checkToolGrant(call.serverId, call.toolName, 'session')
    if (!verdict.valid) {
      // A denied federated call is a soft integrity signal — record it so a misbehaving peer keeps losing trust.
      if (peer) recordActorOutcome(peer, { ok: false })
      return { serverId: call.serverId, toolName: call.toolName, content: [{ type: 'text', text: `Tool blocked by A2A grant policy: ${verdict.reason}` }], isError: true }
    }
    try {
      const resp = await client.callTool({ name: call.toolName, arguments: call.args })
      const isError = resp.isError ?? false
      if (peer) recordActorOutcome(peer, { ok: !isError, up: true })   // feed the federated peer's trust ledger
      return { serverId: call.serverId, toolName: call.toolName, content: resp.content ?? [], isError }
    } catch (e) {
      if (peer) recordActorOutcome(peer, { ok: false, up: false })     // a failed/unreachable peer loses trust
      return {
        serverId: call.serverId,
        toolName: call.toolName,
        content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }],
        isError: true,
      }
    }
  }

  // ── Convenience: all connected tools ─────────────────────────────────────

  allTools(): McpTool[] {
    return Array.from(this.states.values())
      .filter((s) => s.status === 'connected')
      .flatMap((s) => s.tools)
  }
}

// ─── Singleton export ─────────────────────────────────────────────────────────

export const mcpManager = new McpClientManager()
