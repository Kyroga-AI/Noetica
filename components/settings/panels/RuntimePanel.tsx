'use client'

import { useCallback, useEffect, useState } from 'react'
import { useSettings } from '@/lib/settings/context'

type PingStatus = 'idle' | 'checking' | 'reachable' | 'unreachable'

function StatusDot({ status }: { status: PingStatus }) {
  const cls = {
    idle:        'bg-[#94a3b8]',
    checking:    'bg-[#fbbf24] animate-pulse',
    reachable:   'bg-[#22c55e]',
    unreachable: 'bg-[#ef4444]',
  }[status]
  return <span className={`inline-block h-2 w-2 rounded-full ${cls}`} />
}

function StatusLabel({ status }: { status: PingStatus }) {
  return (
    <span className={`font-semibold ${
      status === 'reachable'   ? 'text-[#22c55e]' :
      status === 'unreachable' ? 'text-[#ef4444]' :
      status === 'checking'    ? 'text-[#f59e0b]' : 'text-[#94a3b8]'
    }`}>
      {status === 'reachable'   ? 'Connected' :
       status === 'unreachable' ? 'Unreachable' :
       status === 'checking'    ? 'Checking…' : 'Not checked'}
    </span>
  )
}

export function RuntimePanel() {
  const { settings, update } = useSettings()
  const [amPing, setAmPing] = useState<PingStatus>('idle')

  const pingAgentMachine = useCallback(async () => {
    const ep = settings.agentMachineEndpoint?.trim()
    if (!ep) { setAmPing('unreachable'); return }
    setAmPing('checking')
    try {
      const url = ep.replace(/\/$/, '') + '/api/status'
      const res = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(3000) })
      setAmPing(res.ok ? 'reachable' : 'unreachable')
    } catch {
      setAmPing('unreachable')
    }
  }, [settings.agentMachineEndpoint])

  // Auto-ping when endpoint changes
  useEffect(() => {
    if (settings.runtimeMode === 'agent-machine') {
      void pingAgentMachine()
    } else {
      setAmPing('idle')
    }
  }, [settings.runtimeMode, settings.agentMachineEndpoint, pingAgentMachine])

  const modes = [
    { id: 'standalone',    label: 'Standalone',    description: 'Direct provider calls via local Next.js API routes.' },
    { id: 'agent-machine', label: 'Agent Machine',  description: 'Proxy all requests through your local Agent Machine.' },
    { id: 'sourceos',      label: 'SourceOS',       description: 'Full SourceOS runtime — task ledger, replay, evidence.' },
  ] as const

  return (
    <div className="space-y-6">
      {/* Mode selector */}
      <div>
        <label className="block text-sm font-semibold text-[#0f172a]">Runtime mode</label>
        <div className="mt-3 space-y-2">
          {modes.map((m) => (
            <button key={m.id} onClick={() => update({ runtimeMode: m.id })}
              className={`flex w-full items-start gap-3 rounded-xl border px-4 py-3 text-left transition ${
                settings.runtimeMode === m.id
                  ? 'border-[#1d4ed8] bg-[#eff6ff]'
                  : 'border-[#e2e8f0] bg-white hover:bg-[#f8fafc]'
              }`}>
              <span className={`mt-0.5 h-4 w-4 shrink-0 rounded-full border-2 ${settings.runtimeMode === m.id ? 'border-[#1d4ed8] bg-[#1d4ed8]' : 'border-[#cbd5e1]'}`} />
              <div>
                <p className={`text-sm font-medium ${settings.runtimeMode === m.id ? 'text-[#1d4ed8]' : 'text-[#0f172a]'}`}>{m.label}</p>
                <p className="text-xs text-[#64748b]">{m.description}</p>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Agent Machine endpoint */}
      <div>
        <label className="block text-sm font-semibold text-[#0f172a]">Agent Machine endpoint</label>
        <p className="mt-0.5 text-xs text-[#64748b]">Local agent-machine HTTP service. Used when mode is set to Agent Machine.</p>
        <div className="mt-3 flex gap-2">
          <input type="url" value={settings.agentMachineEndpoint}
            onChange={(e) => { update({ agentMachineEndpoint: e.target.value }); setAmPing('idle') }}
            placeholder="http://localhost:8080"
            className="flex-1 rounded-xl border border-[#bfdbfe] bg-[#f8fafc] px-3 py-2 text-sm text-[#0f172a] outline-none focus:border-[#1d4ed8] focus:bg-white" />
          <button onClick={() => void pingAgentMachine()}
            className="rounded-xl border border-[#e2e8f0] bg-white px-3 py-2 text-xs font-medium text-[#334155] transition hover:border-[#bfdbfe] hover:bg-[#eff6ff] hover:text-[#1d4ed8]">
            Ping
          </button>
        </div>
      </div>

      {/* Live status */}
      <div className="rounded-2xl border border-[#d7dee8] bg-[#f8fafc] p-4">
        <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[#1d4ed8]">Status</div>
        <div className="mt-3 space-y-2.5 text-xs">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <StatusDot status={settings.runtimeMode === 'standalone' ? 'reachable' : 'idle'} />
              <span className="text-[#334155]">Standalone runtime</span>
            </div>
            <span className={`font-semibold ${settings.runtimeMode === 'standalone' ? 'text-[#22c55e]' : 'text-[#94a3b8]'}`}>
              {settings.runtimeMode === 'standalone' ? 'Active' : 'Standby'}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <StatusDot status={settings.runtimeMode === 'agent-machine' ? amPing : 'idle'} />
              <span className="text-[#334155]">Agent Machine</span>
            </div>
            {settings.runtimeMode === 'agent-machine'
              ? <StatusLabel status={amPing} />
              : <span className="font-semibold text-[#94a3b8]">Standby</span>}
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <StatusDot status={settings.runtimeMode === 'sourceos' ? 'checking' : 'idle'} />
              <span className="text-[#334155]">SourceOS</span>
            </div>
            <span className={`font-semibold ${settings.runtimeMode === 'sourceos' ? 'text-[#f59e0b]' : 'text-[#94a3b8]'}`}>
              {settings.runtimeMode === 'sourceos' ? 'Selected' : 'Not configured'}
            </span>
          </div>
        </div>
      </div>

      {/* Agent Machine info when active */}
      {settings.runtimeMode === 'agent-machine' && (
        <div className="rounded-xl border border-[#e2e8f0] bg-[#f8fafc] px-4 py-3 text-xs leading-5 text-[#334155] space-y-1">
          <p className="font-semibold text-[#0f172a]">Agent Machine mode</p>
          <p>All chat requests are proxied to <span className="font-mono text-[#1d4ed8]">{settings.agentMachineEndpoint || 'http://localhost:8080'}/api/chat</span>. The Agent Machine handles model routing, steering, and evidence internally.</p>
          <p className="text-[#64748b]">Start the agent machine with: <span className="font-mono">sourceos agent-machine start</span></p>
        </div>
      )}
    </div>
  )
}
