'use client'

import { useState } from 'react'
import { useSettings } from '@/lib/settings/context'
import type { McpServerConfig } from '@/lib/settings/types'

type ConnectorDef = {
  id: string
  label: string
  authority: 'Native authority' | 'External connector'
  trust: 'Native' | 'Organization trusted' | 'External' | 'Unverified'
  syncModes: string[]
  defaultSync: string
  description: string
}

const NATIVE_CONNECTORS: ConnectorDef[] = [
  { id: 'sourceos',      label: 'SourceOS',              authority: 'Native authority', trust: 'Native',               syncModes: ['native'],         defaultSync: 'native',         description: 'SourceOS substrate — graph, event ledger, policy fabric, agent registry.' },
  { id: 'gitea',         label: 'Gitea Sovereign',        authority: 'Native authority', trust: 'Native',               syncModes: ['bidirectional'],   defaultSync: 'bidirectional',  description: 'Native source-control forge. First-class repository authority.' },
  { id: 'prophet_mail',  label: 'Prophet Mail',           authority: 'Native authority', trust: 'Native',               syncModes: ['bidirectional'],   defaultSync: 'bidirectional',  description: 'Native workspace mail. Gmail and IMAP are optional external connectors.' },
  { id: 'prophet_ws',    label: 'Prophet Workspace',      authority: 'Native authority', trust: 'Native',               syncModes: ['bidirectional'],   defaultSync: 'bidirectional',  description: 'Native workspace calendar, tasks, and documents.' },
  { id: 'sociosphere',   label: 'Sociosphere Graph',      authority: 'Native authority', trust: 'Native',               syncModes: ['bidirectional'],   defaultSync: 'bidirectional',  description: 'Graph intelligence, entity index, time service, and reasoning.' },
  { id: 'matrix',        label: 'Matrix',                 authority: 'Native authority', trust: 'Organization trusted', syncModes: ['bidirectional'],   defaultSync: 'bidirectional',  description: 'Workspace chat rooms, workroom rooms, agent ChatOps.' },
  { id: 'agent_registry',label: 'Agent Registry',         authority: 'Native authority', trust: 'Native',               syncModes: ['native'],         defaultSync: 'native',         description: 'Authoritative agent identity and dispatch registry.' },
]

const EXTERNAL_CONNECTORS: ConnectorDef[] = [
  { id: 'github',   label: 'GitHub',        authority: 'External connector', trust: 'External', syncModes: ['read_only', 'import', 'webhook_only'], defaultSync: 'import',       description: 'Mirror, import, or hook into GitHub repositories. Not source of truth.' },
  { id: 'gmail',    label: 'Gmail',         authority: 'External connector', trust: 'External', syncModes: ['read_only', 'import'],                  defaultSync: 'import',       description: 'Import Gmail threads. Prophet Mail is native.' },
  { id: 'gdrive',   label: 'Google Drive',  authority: 'External connector', trust: 'External', syncModes: ['read_only', 'import'],                  defaultSync: 'read_only',    description: 'Read or import Drive documents.' },
  { id: 'gcal',     label: 'Google Calendar', authority: 'External connector', trust: 'External', syncModes: ['read_only', 'import'],               defaultSync: 'read_only',    description: 'Read Google Calendar events. Prophet Calendar is native.' },
  { id: 'slack',    label: 'Slack',         authority: 'External connector', trust: 'External', syncModes: ['read_only', 'webhook_only'],             defaultSync: 'webhook_only', description: 'Webhook integration or read-only channel sync.' },
  { id: 'gitlab',   label: 'GitLab',        authority: 'External connector', trust: 'External', syncModes: ['read_only', 'import', 'webhook_only'], defaultSync: 'import',       description: 'Mirror or import GitLab repositories. Gitea Sovereign is native.' },
  { id: 'forgejo',  label: 'Forgejo',       authority: 'External connector', trust: 'External', syncModes: ['read_only', 'import'],                  defaultSync: 'import',       description: 'Import or hook into Forgejo/Codeberg.' },
  { id: 'jira',     label: 'Jira',          authority: 'External connector', trust: 'External', syncModes: ['import', 'bidirectional', 'webhook_only'], defaultSync: 'import',    description: 'Import Jira issues. Native work management is source of truth.' },
  { id: 'linear',   label: 'Linear',        authority: 'External connector', trust: 'External', syncModes: ['import', 'webhook_only'],               defaultSync: 'import',       description: 'Import Linear issues.' },
  { id: 'notion',   label: 'Notion',        authority: 'External connector', trust: 'External', syncModes: ['read_only', 'import'],                  defaultSync: 'import',       description: 'Import Notion pages and databases.' },
]

const TRUST_COLORS: Record<string, string> = {
  'Native':               'bg-[#dcfce7] text-[#16a34a]',
  'Organization trusted': 'bg-[#dbeafe] text-[#1d4ed8]',
  'External':             'bg-[#f1f5f9] text-[#64748b]',
  'Unverified':           'bg-[#fef2f2] text-[#dc2626]',
}

function ConnectorRow({ c }: { c: ConnectorDef }) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-xl border border-[#e2e8f0] bg-white p-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-sm font-semibold text-[#0f172a]">{c.label}</span>
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${TRUST_COLORS[c.trust]}`}>{c.trust}</span>
        </div>
        <div className="mt-0.5 text-xs text-[#64748b]">{c.description}</div>
      </div>
      <button className="shrink-0 rounded-lg border border-[#e2e8f0] bg-[#f8fafc] px-2.5 py-1.5 text-xs font-medium text-[#334155] transition hover:bg-white">
        Configure
      </button>
    </div>
  )
}

const MCP_PLACEHOLDER = JSON.stringify(
  { filesystem: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '/path'] } },
  null, 2
)

export function ConnectorsPanel() {
  const { settings, update } = useSettings()
  const [tab, setTab] = useState<'native' | 'external' | 'mcp'>('native')
  const [raw, setRaw] = useState(() =>
    Object.keys(settings.mcpServers).length > 0 ? JSON.stringify(settings.mcpServers, null, 2) : ''
  )
  const [error, setError] = useState('')

  function applyMcp() {
    try {
      const parsed = raw.trim() ? JSON.parse(raw) : {}
      for (const [key, val] of Object.entries(parsed)) {
        const v = val as McpServerConfig
        if (typeof v.command !== 'string') throw new Error(`"${key}" must have a string command`)
      }
      update({ mcpServers: parsed })
      setError('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Invalid JSON')
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <div className="text-sm font-semibold text-[#0f172a]">Connectors</div>
        <p className="mt-0.5 text-xs text-[#64748b]">
          Native connectors are the authoritative substrate. External connectors are optional import/mirror/hook integrations.
        </p>
      </div>

      <div className="flex gap-1 rounded-xl border border-[#e2e8f0] bg-[#f8fafc] p-1">
        {([['native', 'Native'], ['external', 'External'], ['mcp', 'MCP servers']] as const).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex-1 rounded-lg py-1.5 text-xs font-medium transition ${tab === id ? 'bg-white shadow-sm text-[#0f172a]' : 'text-[#64748b] hover:text-[#0f172a]'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'native' && (
        <div className="space-y-2">
          {NATIVE_CONNECTORS.map((c) => <ConnectorRow key={c.id} c={c} />)}
        </div>
      )}

      {tab === 'external' && (
        <div className="space-y-2">
          <p className="text-xs text-[#94a3b8]">External connectors are never default authorities. They import, mirror, or hook into native substrate.</p>
          {EXTERNAL_CONNECTORS.map((c) => <ConnectorRow key={c.id} c={c} />)}
        </div>
      )}

      {tab === 'mcp' && (
        <div className="space-y-3">
          <p className="text-xs text-[#64748b]">
            MCP servers use the same format as Claude Desktop&apos;s <code className="rounded bg-[#f1f5f9] px-1">claude_desktop_config.json</code>.
          </p>
          <textarea
            rows={10}
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            placeholder={MCP_PLACEHOLDER}
            spellCheck={false}
            className="w-full rounded-xl border border-[#bfdbfe] bg-[#f8fafc] px-3 py-2.5 font-mono text-xs text-[#0f172a] outline-none focus:border-[#1d4ed8] focus:bg-white"
          />
          {error && <p className="rounded-xl border border-[#fecaca] bg-[#fef2f2] px-3 py-2 text-xs text-[#dc2626]">{error}</p>}
          <button onClick={applyMcp} className="rounded-xl bg-[#1d4ed8] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#1e40af]">
            Apply
          </button>
        </div>
      )}
    </div>
  )
}
