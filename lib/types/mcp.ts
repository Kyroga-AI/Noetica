// ─── MCP Server configuration ─────────────────────────────────────────────────

/** 'http' = StreamableHTTP — the current MCP spec's default remote transport. The WebView never dials
 *  it directly (CSP confines connect-src to :8080/:11435); the connection is proxied through the
 *  agent-machine sidecar's /api/mcp/remote/* routes, which also puts it on the governed A2A plane. */
export type McpTransport = 'stdio' | 'sse' | 'http'

export interface McpServerConfig {
  id: string
  name: string
  transport: McpTransport
  /** stdio: path or command name, e.g. "npx" */
  command?: string
  /** stdio: argument list, e.g. ["-y", "@modelcontextprotocol/server-filesystem"] */
  args?: string[]
  /** stdio: extra env vars forwarded to the child process */
  env?: Record<string, string>
  /** sse/http: server URL, e.g. "http://localhost:3100/sse" or "https://example.com/mcp" */
  url?: string
  /** sse/http: extra request headers (auth tokens etc.) */
  headers?: Record<string, string>
  enabled: boolean
  createdAt: string
  /** A2A federation: when set, this server is a FEDERATED PEER (e.g. an AIWG / Ruflo / Gas Town node), not a
   *  local tool server. Its tool calls are gated by the peer's behavioral trust (checkActorGrant) and each
   *  outcome feeds the trust ledger — instead of the local-session grant path. */
  spiffeId?: string
  /** UI hint: which framework this peer is (aiwg | ruflo | gastown | …), for presets + the federation panel. */
  peerKind?: string
}

// ─── Runtime state ────────────────────────────────────────────────────────────

export type McpConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

export interface McpTool {
  name: string
  description?: string
  // eslint-disable-next-line
  inputSchema: Record<string, any>
  /** denormalized: which server owns this tool */
  serverId: string
  serverName: string
}

export interface McpResource {
  uri: string
  name?: string
  description?: string
  mimeType?: string
  serverId: string
}

export interface McpServerState {
  config: McpServerConfig
  status: McpConnectionStatus
  tools: McpTool[]
  resources: McpResource[]
  error?: string
  connectedAt?: string
  serverInfo?: { name: string; version: string }
}

// ─── Persistence ──────────────────────────────────────────────────────────────

export interface McpConfigStore {
  servers: McpServerConfig[]
  version: number
}

export const MCP_STORE_VERSION = 1
export const MCP_STORE_KEY = 'noetica:mcp'

// ─── Tool call ────────────────────────────────────────────────────────────────

export interface McpToolCall {
  serverId: string
  toolName: string
  // eslint-disable-next-line
  args: Record<string, any>
}

export interface McpToolResult {
  serverId: string
  toolName: string
  // eslint-disable-next-line
  content: any[]
  isError?: boolean
}
