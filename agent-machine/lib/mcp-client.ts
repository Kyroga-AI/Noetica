/**
 * mcp-client — make Noetica an MCP (Model Context Protocol) CLIENT, so the mesh can consume
 * any of the thousands of existing MCP tool servers (filesystem, git, databases, browsers, …)
 * instead of being limited to its hard-coded built-in tools.
 *
 * MCP is JSON-RPC 2.0. The handshake: initialize → notifications/initialized → tools/list,
 * then tools/call to invoke. Local-first: the default transport is stdio (spawn a server
 * process and talk over its stdin/stdout) — the dominant local case, nothing leaves the box.
 *
 * Config lives at ~/.noetica/mcp.json (same shape as Claude Desktop):
 *   { "mcpServers": { "fs": { "command": "npx", "args": ["-y","@modelcontextprotocol/server-filesystem","/path"] } } }
 *
 * Tools are namespaced `mcp__<server>__<tool>` to avoid collisions with built-ins. The protocol
 * logic is pure over a Transport interface, so it's unit-testable without spawning a process.
 */

import { spawn, type ChildProcess } from 'child_process'
import { readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

// ── JSON-RPC plumbing ───────────────────────────────────────────────────────
interface RpcMessage { jsonrpc: '2.0'; id?: number; method?: string; params?: unknown; result?: unknown; error?: { code: number; message: string } }

export interface Transport {
  start(): Promise<void>
  send(msg: RpcMessage): void
  onMessage(handler: (msg: RpcMessage) => void): void
  close(): void
}

export interface McpTool { name: string; description?: string; inputSchema?: Record<string, unknown> }
export interface McpServerConfig { command?: string; args?: string[]; env?: Record<string, string>; disabled?: boolean }

const REQUEST_TIMEOUT_MS = 30_000
const PROTOCOL_VERSION = '2024-11-05'

/** An MCP client over a Transport. Handles the handshake, tool discovery, and tool calls. */
export class McpClient {
  private nextId = 1
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>()
  private tools: McpTool[] = []
  private connected = false

  constructor(public readonly name: string, private readonly transport: Transport) {}

  private request(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`MCP ${this.name}: ${method} timed out`)) }, REQUEST_TIMEOUT_MS)
      this.pending.set(id, { resolve, reject, timer })
      this.transport.send({ jsonrpc: '2.0', id, method, params })
    })
  }

  private handle(msg: RpcMessage): void {
    if (msg.id == null) return // a notification from the server — ignore
    const p = this.pending.get(msg.id)
    if (!p) return
    this.pending.delete(msg.id)
    clearTimeout(p.timer)
    if (msg.error) p.reject(new Error(`MCP ${this.name}: ${msg.error.message} (${msg.error.code})`))
    else p.resolve(msg.result)
  }

  /** Connect: start transport, do the initialize handshake, discover tools. */
  async connect(): Promise<void> {
    this.transport.onMessage((m) => this.handle(m))
    await this.transport.start()
    await this.request('initialize', { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'noetica', version: '1' } })
    this.transport.send({ jsonrpc: '2.0', method: 'notifications/initialized' })
    const res = (await this.request('tools/list', {})) as { tools?: McpTool[] }
    this.tools = res?.tools ?? []
    this.connected = true
  }

  listTools(): McpTool[] { return this.tools }
  isConnected(): boolean { return this.connected }

  /** Invoke a tool; flattens MCP's content blocks to a string for Noetica's tool loop. */
  async callTool(toolName: string, args: Record<string, unknown>): Promise<string> {
    const r = (await this.request('tools/call', { name: toolName, arguments: args })) as { content?: Array<{ type: string; text?: string }>; isError?: boolean }
    const text = (r?.content ?? []).map((c) => (c.type === 'text' ? c.text ?? '' : `[${c.type}]`)).join('\n').trim()
    return r?.isError ? `Error from ${this.name}/${toolName}: ${text || 'tool reported an error'}` : (text || '(no output)')
  }

  close(): void {
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error('closed')) }
    this.pending.clear()
    this.transport.close()
  }
}

// ── stdio transport: spawn a server process, talk newline-delimited JSON-RPC ──
export class StdioTransport implements Transport {
  private proc?: ChildProcess
  private buf = ''
  private handler: (msg: RpcMessage) => void = () => {}
  constructor(private command: string, private args: string[] = [], private env: Record<string, string> = {}) {}

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.proc = spawn(this.command, this.args, { env: { ...process.env, ...this.env }, stdio: ['pipe', 'pipe', 'pipe'] })
      } catch (e) { reject(e instanceof Error ? e : new Error(String(e))); return }
      this.proc.on('error', reject)
      this.proc.stdout?.on('data', (d: Buffer) => this.onData(d.toString()))
      // MCP servers are ready immediately on spawn; the initialize request gates real readiness.
      resolve()
    })
  }
  private onData(chunk: string): void {
    this.buf += chunk
    let nl: number
    while ((nl = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, nl).trim()
      this.buf = this.buf.slice(nl + 1)
      if (line) { try { this.handler(JSON.parse(line) as RpcMessage) } catch { /* non-JSON log line — skip */ } }
    }
  }
  send(msg: RpcMessage): void { this.proc?.stdin?.write(JSON.stringify(msg) + '\n') }
  onMessage(handler: (msg: RpcMessage) => void): void { this.handler = handler }
  close(): void { this.proc?.kill() }
}

// ── Config + registry ────────────────────────────────────────────────────────
export function loadMcpConfig(path = join(homedir(), '.noetica', 'mcp.json')): Record<string, McpServerConfig> {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as { mcpServers?: Record<string, McpServerConfig> }
    return parsed.mcpServers ?? {}
  } catch { return {} }
}

const registry = new Map<string, McpClient>()

/** Connect to every configured (enabled, stdio) MCP server. Best-effort per server. */
export async function connectAllMcpServers(config = loadMcpConfig()): Promise<{ connected: string[]; failed: string[] }> {
  const connected: string[] = [], failed: string[] = []
  for (const [name, cfg] of Object.entries(config)) {
    if (cfg.disabled || !cfg.command) continue
    try {
      const client = new McpClient(name, new StdioTransport(cfg.command, cfg.args ?? [], cfg.env ?? {}))
      await client.connect()
      registry.set(name, client)
      connected.push(name)
    } catch { failed.push(name) }
  }
  return { connected, failed }
}

// Namespacing: a Noetica tool name is `mcp__<server>__<tool>`.
export const mcpToolName = (server: string, tool: string) => `mcp__${server}__${tool}`
export function parseMcpToolName(qualified: string): { server: string; tool: string } | null {
  const m = /^mcp__([^_]+(?:_[^_]+)*?)__(.+)$/.exec(qualified)
  return m ? { server: m[1]!, tool: m[2]! } : null
}
export const isMcpTool = (name: string): boolean => name.startsWith('mcp__')

/** All connected MCP tools as Noetica tool schemas (for the model's tool list). */
export function mcpToolsForModel(): Array<{ name: string; description: string; input_schema: Record<string, unknown> }> {
  const out: Array<{ name: string; description: string; input_schema: Record<string, unknown> }> = []
  for (const [server, client] of registry) {
    for (const t of client.listTools()) {
      out.push({ name: mcpToolName(server, t.name), description: t.description ?? `${t.name} (via ${server})`, input_schema: t.inputSchema ?? { type: 'object', properties: {} } })
    }
  }
  return out
}

/** Route a namespaced tool call to its MCP server. */
export async function callMcpTool(qualified: string, args: Record<string, unknown>): Promise<string> {
  const parsed = parseMcpToolName(qualified)
  if (!parsed) return `Error: '${qualified}' is not a valid MCP tool name`
  const client = registry.get(parsed.server)
  if (!client) return `Error: MCP server '${parsed.server}' is not connected`
  return client.callTool(parsed.tool, args)
}

export function connectedMcpServers(): string[] { return [...registry.keys()] }
export function closeAllMcpServers(): void { for (const c of registry.values()) c.close(); registry.clear() }
