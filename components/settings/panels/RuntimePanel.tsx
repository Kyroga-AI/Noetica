'use client'

import { useCallback, useEffect, useState } from 'react'
import { useSettings } from '@/lib/settings/context'

type PingStatus = 'idle' | 'checking' | 'reachable' | 'unreachable'

// Shape of the /api/status response from an agent machine
type AgentMachineStatus = {
  version?: string
  models?: string[]
  tools?: string[]
  mode?: string
  description?: string
}

function StatusDot({ status }: { status: PingStatus }) {
  const cls = {
    idle:        'bg-[#94a3b8]',
    checking:    'bg-[#fbbf24] animate-pulse',
    reachable:   'bg-[var(--color-accent)]',
    unreachable: 'bg-[#ef4444]',
  }[status]
  return <span className={`inline-block h-2 w-2 rounded-full ${cls}`} />
}

function StatusLabel({ status }: { status: PingStatus }) {
  return (
    <span className={`font-semibold ${
      status === 'reachable'   ? 'text-[var(--color-accent)]' :
      status === 'unreachable' ? 'text-[#ef4444]' :
      status === 'checking'    ? 'text-[#f59e0b]' : 'text-[var(--color-text-tertiary)]'
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
  const [amInfo, setAmInfo] = useState<AgentMachineStatus | null>(null)

  const pingAgentMachine = useCallback(async () => {
    const ep = settings.agentMachineEndpoint?.trim()
    if (!ep) { setAmPing('unreachable'); setAmInfo(null); return }
    setAmPing('checking')
    setAmInfo(null)
    try {
      const url = ep.replace(/\/$/, '') + '/api/status'
      const res = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(4000) })
      if (res.ok) {
        const data = await res.json().catch(() => ({})) as AgentMachineStatus
        setAmInfo(data)
        setAmPing('reachable')
      } else {
        setAmPing('unreachable')
      }
    } catch {
      setAmPing('unreachable')
    }
  }, [settings.agentMachineEndpoint])

  useEffect(() => {
    if (settings.runtimeMode === 'agent-machine') {
      void pingAgentMachine()
    } else {
      setAmPing('idle')
      setAmInfo(null)
    }
  }, [settings.runtimeMode, settings.agentMachineEndpoint, pingAgentMachine])

  const modes = [
    { id: 'standalone',    label: 'Standalone',    description: 'Direct provider calls. API keys from Settings → API Keys.' },
    { id: 'agent-machine', label: 'Agent Machine',  description: 'Proxy all requests through a local Agent Machine service.' },
    { id: 'sourceos',      label: 'SourceOS',       description: 'Full SourceOS runtime — task ledger, replay, evidence.' },
  ] as const

  return (
    <div className="space-y-6">
      {/* Mode selector */}
      <div>
        <label className="block text-sm font-semibold text-[var(--color-text-primary)]">Runtime mode</label>
        <div className="mt-3 space-y-2">
          {modes.map((m) => (
            <button key={m.id} onClick={() => update({ runtimeMode: m.id })}
              className={`flex w-full items-start gap-3 rounded-xl border px-4 py-3 text-left transition ${
                settings.runtimeMode === m.id
                  ? 'border-[#1d4ed8] bg-[#eff6ff]'
                  : 'border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] hover:bg-[var(--color-background-secondary)]'
              }`}>
              <span className={`mt-0.5 h-4 w-4 shrink-0 rounded-full border-2 ${settings.runtimeMode === m.id ? 'border-[#1d4ed8] bg-[#1d4ed8]' : 'border-[#cbd5e1]'}`} />
              <div>
                <p className={`text-sm font-medium ${settings.runtimeMode === m.id ? 'text-[#1d4ed8]' : 'text-[var(--color-text-primary)]'}`}>{m.label}</p>
                <p className="text-xs text-[var(--color-text-secondary)]">{m.description}</p>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Agent Machine endpoint */}
      <div>
        <label className="block text-sm font-semibold text-[var(--color-text-primary)]">Agent Machine endpoint</label>
        <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">URL of the local agent-machine HTTP service.</p>
        <div className="mt-3 flex gap-2">
          <input type="url" value={settings.agentMachineEndpoint}
            onChange={(e) => { update({ agentMachineEndpoint: e.target.value }); setAmPing('idle'); setAmInfo(null) }}
            placeholder="http://localhost:8080"
            className="flex-1 rounded-xl border border-[#bfdbfe] bg-[var(--color-background-secondary)] px-3 py-2 text-sm text-[var(--color-text-primary)] outline-none focus:border-[#1d4ed8] focus:bg-[var(--color-background-primary)]" />
          <button onClick={() => void pingAgentMachine()}
            className="rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-3 py-2 text-xs font-medium text-[var(--color-text-secondary)] transition hover:border-[#bfdbfe] hover:bg-[#eff6ff] hover:text-[#1d4ed8]">
            Ping
          </button>
        </div>
      </div>

      {/* Agent Machine capability card — shown when connected */}
      {amPing === 'reachable' && amInfo && (
        <div className="rounded-xl border border-[#bbf7d0] bg-[var(--color-accent-bg)] px-4 py-3 space-y-2">
          <div className="flex items-center gap-2">
            <StatusDot status="reachable" />
            <span className="text-xs font-semibold text-[var(--color-accent)]">Agent Machine connected</span>
            {amInfo.version && <span className="ml-auto font-mono text-[11px] text-[var(--color-accent)]">v{amInfo.version}</span>}
          </div>
          {amInfo.description && <p className="text-xs text-[var(--color-accent)]">{amInfo.description}</p>}
          {amInfo.models && amInfo.models.length > 0 && (
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-accent)] mb-1">Available models</div>
              <div className="flex flex-wrap gap-1">
                {amInfo.models.map((m) => (
                  <span key={m} className="rounded-md bg-[var(--color-accent-bg)] px-2 py-0.5 font-mono text-[11px] text-[var(--color-accent)]">{m}</span>
                ))}
              </div>
            </div>
          )}
          {amInfo.tools && amInfo.tools.length > 0 && (
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-accent)] mb-1">Available tools</div>
              <div className="flex flex-wrap gap-1">
                {amInfo.tools.map((t) => (
                  <span key={t} className="rounded-md bg-[var(--color-accent-bg)] px-2 py-0.5 font-mono text-[11px] text-[var(--color-accent)]">{t}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Live status */}
      <div className="rounded-2xl border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] p-4">
        <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[#1d4ed8]">Status</div>
        <div className="mt-3 space-y-2.5 text-xs">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <StatusDot status={settings.runtimeMode === 'standalone' ? 'reachable' : 'idle'} />
              <span className="text-[var(--color-text-secondary)]">Standalone runtime</span>
            </div>
            <span className={`font-semibold ${settings.runtimeMode === 'standalone' ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-tertiary)]'}`}>
              {settings.runtimeMode === 'standalone' ? 'Active' : 'Standby'}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <StatusDot status={settings.runtimeMode === 'agent-machine' ? amPing : 'idle'} />
              <span className="text-[var(--color-text-secondary)]">Agent Machine</span>
            </div>
            {settings.runtimeMode === 'agent-machine'
              ? <StatusLabel status={amPing} />
              : <span className="font-semibold text-[var(--color-text-tertiary)]">Standby</span>}
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <StatusDot status={settings.runtimeMode === 'sourceos' ? 'checking' : 'idle'} />
              <span className="text-[var(--color-text-secondary)]">SourceOS</span>
            </div>
            <span className={`font-semibold ${settings.runtimeMode === 'sourceos' ? 'text-[#f59e0b]' : 'text-[var(--color-text-tertiary)]'}`}>
              {settings.runtimeMode === 'sourceos' ? 'Selected' : 'Not configured'}
            </span>
          </div>
        </div>
      </div>

      {/* Time Service endpoint */}
      <div>
        <label className="block text-sm font-semibold text-[var(--color-text-primary)]">Time Service endpoint</label>
        <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">Optional — enables replay controls in Operate → Time Service.</p>
        <div className="mt-3">
          <input type="url" value={settings.timeServiceEndpoint}
            onChange={(e) => update({ timeServiceEndpoint: e.target.value })}
            placeholder="http://localhost:9090"
            className="w-full rounded-xl border border-[var(--color-border-tertiary)] bg-[var(--color-background-secondary)] px-3 py-2 text-sm text-[var(--color-text-primary)] outline-none focus:border-[#1d4ed8] focus:bg-[var(--color-background-primary)]" />
        </div>
      </div>

      {/* Agent Machine usage note */}
      {settings.runtimeMode === 'agent-machine' && (
        <div className="rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] px-4 py-3 text-xs leading-5 text-[var(--color-text-secondary)] space-y-1.5">
          <p className="font-semibold text-[var(--color-text-primary)]">How Agent Machine mode works</p>
          <p>All chat requests are forwarded to <span className="font-mono text-[#1d4ed8]">{(settings.agentMachineEndpoint || 'http://localhost:8080').replace(/\/$/, '')}/api/chat</span>. The machine handles model routing, tool execution, and evidence internally.</p>
          <p>The machine must speak the <span className="font-mono">Noetica SSE protocol</span> — streaming <code className="rounded bg-[var(--color-background-primary)] px-1">meta</code>, <code className="rounded bg-[var(--color-background-primary)] px-1">delta</code>, <code className="rounded bg-[var(--color-background-primary)] px-1">tool_calls</code>, and <code className="rounded bg-[var(--color-background-primary)] px-1">done</code> events.</p>
          <p className="text-[var(--color-text-tertiary)]">Start with: <span className="font-mono">sourceos agent-machine start</span></p>
        </div>
      )}
    </div>
  )
}
