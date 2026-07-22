'use client'

import { useState } from 'react'
import { useMcp } from '@/lib/mcp/useMcp'
import type { McpServerConfig, McpServerState, McpTransport } from '@/lib/types/mcp'
import { isTauri } from '@/lib/tauri/bridge'
import { useConnectorAuth } from '@/lib/auth/context'
import type { ConnectorId } from '@/lib/auth/types'

// Curated MCP marketplace — popular servers with one-click add.
//  • stdio servers: `command` (default 'npx') + `args`; `env` keys are placeholders (API tokens) the user fills in
//    after adding. `desktop: true` marks them as needing the Tauri app — they spawn a local child process.
//  • remote servers: `url` (transport 'sse'); `headers` are auth-header placeholders. These also work in-browser
//    (no child process), so they're the most portable given the sandbox.
type CatalogueEntry = {
  name: string
  description: string
  desktop: boolean
  command?: string
  args?: string[]
  env?: string[]
  url?: string
  headers?: string[]
}
const MCP_CATALOGUE: CatalogueEntry[] = [
  { name: 'Filesystem', description: 'Read/write files in a directory you choose.', args: ['-y', '@modelcontextprotocol/server-filesystem', '~'], desktop: true },
  { name: 'GitHub', description: 'Repos, issues, PRs, code search.', args: ['-y', '@modelcontextprotocol/server-github'], env: ['GITHUB_PERSONAL_ACCESS_TOKEN'], desktop: true },
  { name: 'Brave Search', description: 'Web + local search via the Brave API.', args: ['-y', '@modelcontextprotocol/server-brave-search'], env: ['BRAVE_API_KEY'], desktop: true },
  { name: 'PostgreSQL', description: 'Read-only SQL over a Postgres database.', args: ['-y', '@modelcontextprotocol/server-postgres', 'postgresql://localhost/mydb'], desktop: true },
  { name: 'SQLite', description: 'Query + analyze a local SQLite database.', args: ['-y', '@modelcontextprotocol/server-sqlite', '--db-path', '~/db.sqlite'], desktop: true },
  { name: 'Memory', description: 'A persistent knowledge-graph memory.', args: ['-y', '@modelcontextprotocol/server-memory'], desktop: true },
  { name: 'Puppeteer', description: 'Drive a headless browser — navigate, screenshot, scrape.', args: ['-y', '@modelcontextprotocol/server-puppeteer'], desktop: true },
  { name: 'Slack', description: 'Read channels, post messages.', args: ['-y', '@modelcontextprotocol/server-slack'], env: ['SLACK_BOT_TOKEN', 'SLACK_TEAM_ID'], desktop: true },
  { name: 'Fetch', description: 'Fetch a URL and return clean markdown.', args: ['-y', '@modelcontextprotocol/server-fetch'], desktop: true },
  { name: 'Git', description: 'Inspect + operate on a local git repo.', args: ['-y', '@modelcontextprotocol/server-git'], desktop: true },
  // ─── Capability plugins (Claude marketplace) — Prism-style agent integrations ───
  // Research & literature search
  { name: 'Exa Search', description: 'Neural web + literature search and crawling — arXiv-grade research.', args: ['-y', 'exa-mcp-server'], env: ['EXA_API_KEY'], desktop: true },
  { name: 'Tavily Search', description: 'Real-time web search, extract, map & crawl.', args: ['-y', 'tavily-mcp'], env: ['TAVILY_API_KEY'], desktop: true },
  // Knowledge & vector store
  { name: 'Qdrant', description: 'Semantic memory over a Qdrant vector store — store & retrieve.', command: 'uvx', args: ['mcp-server-qdrant'], env: ['QDRANT_URL', 'QDRANT_API_KEY'], desktop: true },
  { name: 'Dropbox', description: 'Search and read your Dropbox files. Official remote MCP (OAuth).', url: 'https://mcp.dropbox.com/mcp', desktop: false },
  // Docs & figures
  { name: 'Canva', description: 'Create/edit designs and generate figures & diagrams. Official remote MCP (OAuth).', url: 'https://mcp.canva.com/mcp', desktop: false },
  // Dev & observability
  { name: 'Datadog', description: 'Query metrics, logs, monitors, traces & incidents. Official remote MCP.', url: 'https://mcp.datadoghq.com/api/unstable/mcp-server/mcp', headers: ['Authorization'], desktop: false },
  { name: 'Buildkite', description: 'Inspect pipelines, builds, jobs & logs. Official MCP (via Docker).', command: 'docker', args: ['run', '--pull=always', '-q', '--rm', '-i', '-e', 'BUILDKITE_API_TOKEN', 'buildkite/mcp-server', 'stdio'], env: ['BUILDKITE_API_TOKEN'], desktop: true },
  { name: 'Langfuse', description: 'LLM observability & prompt management. Official remote MCP.', url: 'https://cloud.langfuse.com/api/public/mcp', headers: ['Authorization'], desktop: false },
]

// Map connector list IDs to ConnectorId where auth exists
const AUTH_CONNECTOR_MAP: Record<string, ConnectorId> = {
  github: 'github',
  slack:  'slack',
  gmail:  'google',
  gdrive: 'google',
  gcal:   'google',
}

const NATIVE_CONNECTORS = [
  { id: 'sourceos',  label: 'SourceOS',            trust: 'Native',               description: 'Primary substrate. All data flows, governance, and agent runtime.' },
  { id: 'gitea',     label: 'Gitea Sovereign',      trust: 'Native',               description: 'Self-hosted sovereign Git forge. Canonical source control authority.' },
  { id: 'mail',      label: 'Prophet Mail',         trust: 'Native',               description: 'Noetica-native encrypted mail. Inbox lives in your sovereign workspace.' },
  { id: 'workspace', label: 'Prophet Workspace',    trust: 'Native',               description: 'Sovereign document workspace. Notes, wikis, and collaborative docs.' },
  { id: 'graph',     label: 'Sociosphere Graph',    trust: 'Native',               description: 'Knowledge graph of your org, repos, people, and events.' },
  { id: 'matrix',    label: 'Matrix',               trust: 'Organization trusted', description: 'Federated chat and chatops. Native Workrooms substrate.' },
  { id: 'agents',    label: 'Agent Registry',       trust: 'Native',               description: 'AgentPlane registry. Defines, schedules, and dispatches agents.' },
]

const EXTERNAL_CONNECTORS = [
  { id: 'github',  label: 'GitHub',          trust: 'External',    description: 'External Git hosting. Mirror into Gitea Sovereign for sovereign control.' },
  { id: 'gmail',   label: 'Gmail',           trust: 'External',    description: 'External email. Use Prophet Mail for sovereign alternative.' },
  { id: 'gdrive',  label: 'Google Drive',    trust: 'External',    description: 'Cloud file storage import. Use Prophet Workspace natively.' },
  { id: 'gcal',    label: 'Google Calendar', trust: 'External',    description: 'Calendar sync. Noetica native calendar available as default.' },
  { id: 'slack',   label: 'Slack',           trust: 'External',    description: 'External chat. Use Matrix Workrooms for sovereign alternative.' },
  { id: 'gitlab',  label: 'GitLab',          trust: 'External',    description: 'External Git forge connector.' },
  { id: 'forgejo', label: 'Forgejo',         trust: 'Organization trusted', description: 'Forgejo / Codeberg. Organization-trusted forge.' },
  { id: 'jira',    label: 'Jira',            trust: 'External',    description: 'External issue tracker. Noetica Projects is the native alternative.' },
  { id: 'linear',  label: 'Linear',          trust: 'External',    description: 'External issue tracker.' },
  { id: 'notion',  label: 'Notion',          trust: 'Unverified',  description: 'External knowledge base. Use Prophet Workspace natively.' },
]

const TRUST_COLORS: Record<string, string> = {
  'Native':               'bg-[var(--color-accent-bg)] text-[var(--color-accent)]',
  'Organization trusted': 'bg-[#dbeafe] text-[#1e40af]',
  'External':             'bg-[var(--color-background-tertiary)] text-[var(--color-text-secondary)]',
  'Unverified':           'bg-[#fee2e2] text-[#991b1b]',
}

function ConnectorRow({
  label, trust, description, authConnected, authUser, onConfigure
}: {
  label: string
  trust: string
  description: string
  authConnected?: boolean
  authUser?: string
  onConfigure?: () => void
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-4 py-3">
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-[var(--color-text-primary)]">{label}</span>
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${TRUST_COLORS[trust] ?? ''}`}>{trust}</span>
          {authConnected && (
            <span className="rounded-full bg-[var(--color-accent-bg)] px-2 py-0.5 text-[11px] font-semibold text-[var(--color-accent)]">Connected</span>
          )}
        </div>
        <p className="text-xs text-[var(--color-text-secondary)]">{description}</p>
        {authConnected && authUser && (
          <p className="text-[11px] text-[var(--color-text-tertiary)]">{authUser}</p>
        )}
      </div>
      {onConfigure && (
        <button onClick={onConfigure} className="shrink-0 rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] px-3 py-1.5 text-xs font-medium text-[var(--color-text-secondary)] transition hover:border-[#bfdbfe] hover:bg-[#eff6ff] hover:text-[#1d4ed8]">
          {authConnected ? 'Manage' : 'Configure'}
        </button>
      )}
    </div>
  )
}

const STATUS_DOT: Record<string, string> = {
  disconnected: 'bg-[#94a3b8]',
  connecting:   'bg-[#fbbf24] animate-pulse',
  connected:    'bg-[var(--color-accent)]',
  error:        'bg-[#ef4444]',
}

function McpStatusChip({ status }: { status: string }) {
  return (
    <span className="flex items-center gap-1.5 text-xs text-[var(--color-text-secondary)]">
      <span className={`h-2 w-2 rounded-full ${STATUS_DOT[status] ?? STATUS_DOT.disconnected}`} />
      {status === 'connecting' ? 'Connecting…' : status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  )
}

type AddForm = { name: string; transport: McpTransport; url: string; command: string; args: string; env: string }
const EMPTY_FORM: AddForm = { name: '', transport: 'http', url: '', command: '', args: '', env: '' }   // StreamableHTTP is what new remote servers default to

function AddServerForm({ onAdd, onCancel }: {
  onAdd: (cfg: Omit<McpServerConfig, 'id' | 'createdAt'>) => void
  onCancel: () => void
}) {
  const [form, setForm] = useState<AddForm>(EMPTY_FORM)
  const [error, setError] = useState('')
  const canStdio = isTauri()

  function set<K extends keyof AddForm>(k: K, v: AddForm[K]) { setForm((f) => ({ ...f, [k]: v })); setError('') }

  function submit() {
    if (!form.name.trim()) { setError('Name is required'); return }
    if (form.transport !== 'stdio' && !form.url.trim()) { setError(`URL is required for ${form.transport === 'sse' ? 'SSE' : 'StreamableHTTP'} transport`); return }
    if (form.transport === 'stdio' && !form.command.trim()) { setError('Command is required for stdio transport'); return }
    let env: Record<string, string> | undefined
    if (form.env.trim()) {
      try { env = JSON.parse(form.env) }
      catch { setError('Env must be valid JSON object'); return }
    }
    onAdd({
      name: form.name.trim(), transport: form.transport, enabled: true,
      url: form.transport !== 'stdio' ? form.url.trim() : undefined,
      command: form.transport === 'stdio' ? form.command.trim() : undefined,
      args: form.transport === 'stdio' && form.args.trim() ? form.args.trim().split(/\s+/) : undefined,
      env,
    })
  }

  return (
    <div className="rounded-xl border border-[#bfdbfe] bg-[#eff6ff] p-4 space-y-3">
      <p className="text-xs font-semibold text-[#1d4ed8]">Add MCP Server</p>
      <div className="space-y-1">
        <label className="text-xs font-medium text-[var(--color-text-secondary)]">Display name</label>
        <input className="w-full rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-3 py-1.5 text-sm outline-none focus:border-[#93c5fd]"
          placeholder="My MCP server" value={form.name} onChange={(e) => set('name', e.target.value)} />
      </div>
      <div className="space-y-1">
        <label className="text-xs font-medium text-[var(--color-text-secondary)]">Transport</label>
        <div className="flex gap-2">
          {(['http', 'sse', 'stdio'] as McpTransport[]).map((t) => (
            <button key={t} type="button" disabled={t === 'stdio' && !canStdio}
              onClick={() => set('transport', t)}
              className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${form.transport === t ? 'border-[#1d4ed8] bg-[#1d4ed8] text-white' : 'border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] text-[var(--color-text-secondary)] hover:border-[#bfdbfe]'}`}>
              {t === 'http' ? 'StreamableHTTP' : t === 'sse' ? 'SSE (legacy)' : 'stdio (Tauri)'}
            </button>
          ))}
        </div>
        {form.transport === 'stdio' && !canStdio && (
          <p className="text-[11px] text-[#f59e0b]">stdio transport requires the Tauri desktop app</p>
        )}
        {form.transport === 'http' && (
          <p className="text-[11px] text-[var(--color-text-tertiary)]">Routed through the agent-machine sidecar — every call is identity-attributed and trust-gated on the governance plane.</p>
        )}
      </div>
      {form.transport !== 'stdio' && (
        <div className="space-y-1">
          <label className="text-xs font-medium text-[var(--color-text-secondary)]">Server URL</label>
          <input className="w-full rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-3 py-1.5 font-mono text-xs outline-none focus:border-[#93c5fd]"
            placeholder={form.transport === 'sse' ? 'http://localhost:3100/sse' : 'https://example.com/mcp'} value={form.url} onChange={(e) => set('url', e.target.value)} />
        </div>
      )}
      {form.transport === 'stdio' && (<>
        <div className="space-y-1">
          <label className="text-xs font-medium text-[var(--color-text-secondary)]">Command</label>
          <input className="w-full rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-3 py-1.5 font-mono text-xs outline-none focus:border-[#93c5fd]"
            placeholder="npx" value={form.command} onChange={(e) => set('command', e.target.value)} />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-[var(--color-text-secondary)]">Arguments <span className="font-normal text-[var(--color-text-tertiary)]">(space-separated)</span></label>
          <input className="w-full rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-3 py-1.5 font-mono text-xs outline-none focus:border-[#93c5fd]"
            placeholder="-y @modelcontextprotocol/server-filesystem /path" value={form.args} onChange={(e) => set('args', e.target.value)} />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-[var(--color-text-secondary)]">Env vars <span className="font-normal text-[var(--color-text-tertiary)]">(JSON, optional)</span></label>
          <input className="w-full rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-3 py-1.5 font-mono text-xs outline-none focus:border-[#93c5fd]"
            placeholder='{"API_KEY": "..."}' value={form.env} onChange={(e) => set('env', e.target.value)} />
        </div>
      </>)}
      {error && <p className="rounded-lg border border-[#fecaca] bg-[#fef2f2] px-3 py-1.5 text-xs text-[#dc2626]">{error}</p>}
      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={onCancel} className="rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-4 py-1.5 text-xs font-medium text-[var(--color-text-secondary)] transition hover:bg-[var(--color-background-tertiary)]">Cancel</button>
        <button type="button" onClick={submit} className="rounded-lg bg-[#1d4ed8] px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-[#1e40af]">Add &amp; Connect</button>
      </div>
    </div>
  )
}

function McpServerRow({ state, onConnect, onDisconnect, onRemove }: {
  state: McpServerState; onConnect: () => void; onDisconnect: () => void; onRemove: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const { config, status, tools, resources, error } = state
  return (
    <div className="rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)]">
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-[var(--color-text-primary)]">{config.name}</span>
            <span className="rounded-full border border-[var(--color-border-secondary)] px-2 py-0.5 text-[11px] font-mono text-[var(--color-text-secondary)]">{config.transport}</span>
            <McpStatusChip status={status} />
          </div>
          <p className="mt-0.5 truncate text-xs text-[var(--color-text-tertiary)]">
            {config.transport === 'stdio' ? `${config.command} ${(config.args ?? []).join(' ')}` : config.url}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {tools.length > 0 && (
            <button onClick={() => setExpanded((v) => !v)}
              className="rounded-lg border border-[var(--color-border-secondary)] px-2 py-1 text-[11px] font-medium text-[var(--color-text-secondary)] transition hover:border-[#bfdbfe] hover:text-[#1d4ed8]">
              {tools.length} tool{tools.length !== 1 ? 's' : ''} {expanded ? '▲' : '▼'}
            </button>
          )}
          {status === 'connected'
            ? <button onClick={onDisconnect} className="rounded-lg border border-[var(--color-border-secondary)] px-2.5 py-1 text-[11px] font-medium text-[var(--color-text-secondary)] transition hover:border-[#fecaca] hover:text-[#dc2626]">Disconnect</button>
            : <button onClick={onConnect} className="rounded-lg border border-[#bfdbfe] bg-[#eff6ff] px-2.5 py-1 text-[11px] font-semibold text-[#1d4ed8] transition hover:bg-[#dbeafe]">Connect</button>}
          <button onClick={onRemove} title="Remove"
            className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--color-text-tertiary)] transition hover:bg-[#fee2e2] hover:text-[#dc2626]">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
              <path d="M1.5 3h9M5 3V2h2v1M4.5 9.5V5m3 4.5V5M2 3l.5 7.5h7L10 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </div>
      </div>
      {error && <div className="border-t border-[#fee2e2] bg-[#fef2f2] px-4 py-2 text-xs text-[#dc2626]">{error}</div>}
      {expanded && tools.length > 0 && (
        <div className="border-t border-[var(--color-border-secondary)] px-4 py-3 space-y-1.5">
          <p className="text-[11px] font-semibold text-[var(--color-text-secondary)]">Tools</p>
          {tools.map((t) => (
            <div key={t.name} className="rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] px-3 py-2">
              <p className="text-xs font-semibold text-[var(--color-text-primary)]">{t.name}</p>
              {t.description && <p className="text-xs text-[var(--color-text-secondary)]">{t.description}</p>}
            </div>
          ))}
          {resources.length > 0 && (<>
            <p className="mt-2 text-[11px] font-semibold text-[var(--color-text-secondary)]">Resources ({resources.length})</p>
            {resources.slice(0, 5).map((r) => (
              <div key={r.uri} className="rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] px-3 py-1.5">
                <p className="truncate font-mono text-[11px] text-[var(--color-text-secondary)]">{r.uri}</p>
              </div>
            ))}
          </>)}
        </div>
      )}
    </div>
  )
}

type TabId = 'native' | 'external' | 'mcp'

export function ConnectorsPanel({ onNavigate }: { onNavigate?: (id: string) => void } = {}) {
  const [tab, setTab] = useState<TabId>('mcp')
  const [showAdd, setShowAdd] = useState(false)
  const [showCatalogue, setShowCatalogue] = useState(false)
  const [added, setAdded] = useState<Record<string, boolean>>({})
  const { serverStates, tools, addServer, connect, disconnect, removeServer, hydrated } = useMcp()
  const { store } = useConnectorAuth()

  const tabs: { id: TabId; label: string; badge?: string }[] = [
    { id: 'native',   label: 'Native' },
    { id: 'external', label: 'External' },
    { id: 'mcp',      label: 'MCP Servers', badge: tools.length > 0 ? String(tools.length) : undefined },
  ]

  return (
    <div className="space-y-4">
      <div className="flex gap-1 rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] p-1">
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-medium transition ${tab === t.id ? 'bg-[var(--color-background-primary)] font-semibold text-[var(--color-text-primary)] shadow-sm' : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'}`}>
            {t.label}
            {t.badge && <span className="rounded-full bg-[var(--color-accent)] px-1.5 py-0.5 text-[11px] font-bold text-white">{t.badge}</span>}
          </button>
        ))}
      </div>

      {tab === 'native' && (
        <div className="space-y-2">
          <p className="text-xs text-[var(--color-text-secondary)]">Native substrates are first-class authorities within SourceOS — not optional connectors.</p>
          {NATIVE_CONNECTORS.map((c) => <ConnectorRow key={c.id} {...c} />)}
        </div>
      )}

      {tab === 'external' && (
        <div className="space-y-2">
          <div className="rounded-xl border border-[var(--color-attention-bg)] bg-[var(--color-attention-bg)] px-4 py-2.5 text-xs text-[#854d0e]">
            External connectors are optional integrations. Native SourceOS alternatives exist for all of these.
          </div>
          {EXTERNAL_CONNECTORS.map((c) => {
            const authId = AUTH_CONNECTOR_MAP[c.id]
            const authState = authId ? store[authId] : undefined
            const connected = authState?.status === 'connected'
            return (
              <ConnectorRow
                key={c.id}
                {...c}
                authConnected={connected}
                authUser={connected ? authState?.userInfo?.email ?? authState?.userInfo?.login : undefined}
                onConfigure={onNavigate ? () => onNavigate('connections') : undefined}
              />
            )
          })}
        </div>
      )}

      {tab === 'mcp' && (
        <div className="space-y-3">
          <div className="rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] px-4 py-3 text-xs leading-5 text-[var(--color-text-secondary)] space-y-1">
            <p className="font-semibold text-[var(--color-text-primary)]">Model Context Protocol servers</p>
            <p>Connect any MCP-compatible server to expose tools and resources in the Noetica chat. StreamableHTTP (via the governed sidecar) and SSE work everywhere; stdio requires the Tauri desktop app.</p>
          </div>
          {!hydrated && <p className="py-4 text-center text-xs text-[var(--color-text-tertiary)]">Loading…</p>}
          {hydrated && serverStates.length === 0 && !showAdd && (
            <div className="rounded-xl border border-dashed border-[#bfdbfe] bg-[#eff6ff] py-8 text-center">
              <p className="text-sm font-medium text-[var(--color-text-secondary)]">No MCP servers configured</p>
              <p className="mt-1 text-xs text-[var(--color-text-secondary)]">Add a server to expose tools and resources to the chat</p>
            </div>
          )}
          {hydrated && serverStates.map((state) => (
            <McpServerRow key={state.config.id} state={state}
              onConnect={() => void connect(state.config.id)}
              onDisconnect={() => void disconnect(state.config.id)}
              onRemove={() => void removeServer(state.config.id)} />
          ))}
          {showAdd
            ? <AddServerForm onAdd={(cfg) => { void addServer(cfg); setShowAdd(false) }} onCancel={() => setShowAdd(false)} />
            : <button onClick={() => setShowAdd(true)}
                className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-[#bfdbfe] py-2.5 text-xs font-semibold text-[#1d4ed8] transition hover:border-[#1d4ed8] hover:bg-[#eff6ff]">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden><path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                Add MCP server
              </button>}

          {/* Marketplace — one-click add for popular MCP servers */}
          <button onClick={() => setShowCatalogue((v) => !v)}
            className="flex w-full items-center justify-between rounded-xl border border-[var(--color-border-secondary)] px-4 py-2 text-xs font-semibold text-[var(--color-text-secondary)] transition hover:bg-[var(--color-background-secondary)]">
            <span>Browse marketplace — popular connectors</span>
            <span className="text-[var(--color-text-tertiary)]">{showCatalogue ? '▲' : '▼'}</span>
          </button>
          {showCatalogue && (
            <div className="grid gap-2 sm:grid-cols-2">
              {MCP_CATALOGUE.map((c) => {
                const blocked = c.desktop && !isTauri()
                return (
                  <div key={c.name} className="flex flex-col rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] p-3">
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-xs font-semibold text-[var(--color-text-primary)]">{c.name}</span>
                      {c.desktop
                        ? <span className="shrink-0 rounded-full bg-[var(--color-background-tertiary)] px-1.5 py-0.5 text-[11px] text-[var(--color-text-tertiary)]">desktop</span>
                        : c.url && <span className="shrink-0 rounded-full bg-[var(--color-background-tertiary)] px-1.5 py-0.5 text-[11px] text-[var(--color-text-tertiary)]">remote</span>}
                    </div>
                    <p className="mt-0.5 flex-1 text-[11px] leading-4 text-[var(--color-text-secondary)]">{c.description}</p>
                    {(c.env || c.headers) && <p className="mt-1 text-[11px] text-[var(--color-text-tertiary)]">needs: {(c.env ?? c.headers ?? []).join(', ')}</p>}
                    <button disabled={blocked || added[c.name]}
                      title={blocked ? 'stdio servers need the Tauri desktop app' : ''}
                      onClick={() => {
                        const cfg: Omit<McpServerConfig, 'id' | 'createdAt'> = c.url
                          ? { name: c.name, transport: 'sse', url: c.url, headers: (c.headers ?? []).reduce((o, k) => ({ ...o, [k]: '' }), {} as Record<string, string>), enabled: true }
                          : { name: c.name, transport: 'stdio', command: c.command ?? 'npx', args: c.args ?? [], env: (c.env ?? []).reduce((o, k) => ({ ...o, [k]: '' }), {} as Record<string, string>), enabled: true }
                        void addServer(cfg); setAdded((a) => ({ ...a, [c.name]: true }))
                      }}
                      className="mt-2 rounded-lg border border-[#bfdbfe] bg-[#eff6ff] px-2 py-1 text-[11px] font-semibold text-[#1d4ed8] transition hover:bg-[#dbeafe] disabled:opacity-50">
                      {added[c.name] ? '✓ Added — configure below' : blocked ? 'Desktop only' : '+ Add'}
                    </button>
                  </div>
                )
              })}
            </div>
          )}
          {tools.length > 0 && (
            <div className="rounded-xl border border-[var(--color-accent-bg)] bg-[var(--color-accent-bg)] px-4 py-3 space-y-1.5">
              <p className="text-xs font-semibold text-[var(--color-accent)]">{tools.length} tool{tools.length !== 1 ? 's' : ''} available</p>
              <div className="flex flex-wrap gap-1.5">
                {tools.map((t) => (
                  <span key={`${t.serverId}:${t.name}`}
                    className="rounded-full border border-[#bbf7d0] bg-[var(--color-accent-bg)] px-2.5 py-0.5 font-mono text-[11px] text-[var(--color-accent)]">
                    {t.name}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
