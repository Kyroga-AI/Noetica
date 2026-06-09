'use client'

import { useState } from 'react'
import { useSettings } from '@/lib/settings/context'
import type { McpServerConfig } from '@/lib/settings/types'

const PLACEHOLDER = JSON.stringify(
  {
    filesystem: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '/path/to/allowed']
    }
  },
  null,
  2
)

export function ConnectorsPanel() {
  const { settings, update } = useSettings()
  const [raw, setRaw] = useState(() => {
    const existing = settings.mcpServers
    return Object.keys(existing).length > 0
      ? JSON.stringify(existing, null, 2)
      : ''
  })
  const [error, setError] = useState('')

  function apply() {
    try {
      const parsed = raw.trim() ? JSON.parse(raw) : {}
      // Validate shape — each value must have a `command` string
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
        <div className="text-sm font-semibold text-[#0f172a]">MCP servers</div>
        <p className="mt-1 text-xs leading-5 text-[#64748b]">
          Same format as Claude Desktop&apos;s <code className="rounded bg-[#f1f5f9] px-1">claude_desktop_config.json</code>. Each key is a server name; each value needs at minimum a <code className="rounded bg-[#f1f5f9] px-1">command</code> field.
        </p>
      </div>

      <textarea
        rows={12}
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        placeholder={PLACEHOLDER}
        spellCheck={false}
        className="w-full rounded-xl border border-[#bfdbfe] bg-[#f8fafc] px-3 py-2.5 font-mono text-xs text-[#0f172a] outline-none focus:border-[#1d4ed8] focus:bg-white"
      />

      {error && (
        <p className="rounded-xl border border-[#fecaca] bg-[#fef2f2] px-3 py-2 text-xs text-[#dc2626]">{error}</p>
      )}

      <button
        onClick={apply}
        className="rounded-xl bg-[#1d4ed8] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#1e40af]"
      >
        Apply
      </button>

      {Object.keys(settings.mcpServers).length > 0 && (
        <div className="rounded-2xl border border-[#d7dee8] bg-[#f8fafc] p-4">
          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[#1d4ed8]">Active servers</div>
          <div className="mt-2 space-y-1">
            {Object.entries(settings.mcpServers).map(([name, cfg]) => (
              <div key={name} className="flex items-center justify-between text-xs">
                <span className="font-semibold text-[#0f172a]">{name}</span>
                <span className="text-[#64748b]">{cfg.command} {cfg.args?.join(' ')}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
