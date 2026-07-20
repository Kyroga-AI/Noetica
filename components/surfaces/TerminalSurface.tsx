'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Workstation → Terminal — the operator console. Runs the canonical operator CLIs (prophet-cli /
 * sourceos-devtools' sourceosctl) via an allow-listed, injection-safe backend runner, streamed live.
 * The operator-parity surface that pairs with Deploy.
 */

const amBase = () =>
  typeof window !== 'undefined' && (window as unknown as { __TAURI__?: unknown }).__TAURI__ ? 'http://127.0.0.1:8080' : ''

type Tool = 'prophet' | 'sourceosctl'
type Status = { tools: Record<Tool, { bin: string; installed: boolean; subcommands: string[] }> }

export function TerminalSurface() {
  const [status, setStatus] = useState<Status | null>(null)
  const [statusErr, setStatusErr] = useState('')
  const [tool, setTool] = useState<Tool>('prophet')
  const [input, setInput] = useState('')
  const [log, setLog] = useState<string[]>([])
  const [exitCode, setExitCode] = useState<number | null>(null)
  const [running, setRunning] = useState(false)
  const logRef = useRef<HTMLDivElement>(null)

  const loadStatus = useCallback(async () => {
    setStatusErr('')
    try {
      const res = await fetch(`${amBase()}/api/terminal/status`)
      if (!res.ok) throw new Error(`status ${res.status}`)
      setStatus((await res.json()) as Status)
    } catch (e) {
      setStatusErr(e instanceof Error ? e.message : 'Could not reach agent-machine backend')
    }
  }, [])
  useEffect(() => { void loadStatus() }, [loadStatus])
  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight }) }, [log])

  async function run(cmd?: string) {
    const raw = (cmd ?? input).trim()
    if (!raw || running) return
    const args = raw.split(/\s+/)
    setRunning(true); setLog([]); setExitCode(null)
    try {
      const res = await fetch(`${amBase()}/api/terminal/run`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tool, args }),
      })
      if (!res.ok || !res.body) throw new Error('failed to start')
      const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = ''
      for (;;) {
        const { done, value } = await reader.read(); if (done) break
        buf += dec.decode(value, { stream: true }); const lines = buf.split('\n'); buf = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data:')) continue
          try {
            const ev = JSON.parse(line.slice(5)) as { line?: string; stream?: string; error?: string; code?: number }
            if (ev.error) setLog((l) => [...l, `✗ ${ev.error}`])
            else if (ev.line != null) setLog((l) => [...l, (ev.stream === 'err' ? '⚠ ' : '') + ev.line])
            else if (ev.code != null) setExitCode(ev.code)
          } catch { /* skip */ }
        }
      }
    } catch (e) {
      setLog((l) => [...l, `✗ ${e instanceof Error ? e.message : 'run failed'}`])
    } finally { setRunning(false) }
  }

  const cur = status?.tools[tool]
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-6">
      <div className="mx-auto w-full max-w-3xl space-y-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-lg font-semibold text-[var(--color-text-primary)]">Terminal</span>
            <span className="rounded-full bg-[#eff6ff] px-2 py-0.5 text-[11px] font-semibold text-[#1d4ed8]">Operator CLIs · prophet · sourceosctl</span>
          </div>
          <div className="text-xs text-[var(--color-text-secondary)]">Run allow-listed operator commands on-device. Injection-safe (no shell).</div>
        </div>

        {/* Tool selector + status */}
        <div className="flex flex-wrap items-center gap-2">
          {(['prophet', 'sourceosctl'] as Tool[]).map((t) => {
            const inst = status?.tools[t]?.installed
            return (
              <button key={t} onClick={() => { setTool(t); setInput('') }}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${tool === t ? 'bg-[#dbeafe] text-[#1d4ed8]' : 'border border-[var(--color-border-secondary)] text-[var(--color-text-secondary)] hover:bg-[var(--color-background-secondary)]'}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${inst ? 'bg-[var(--color-accent)]' : 'bg-[#94a3b8]'}`} />{t}
              </button>
            )
          })}
          {statusErr && <span className="text-[11px] text-[#dc2626]">{statusErr} — run under dev:app</span>}
          {cur && !cur.installed && <span className="text-[11px] text-[var(--color-text-tertiary)]">{cur.bin} not installed</span>}
        </div>

        {/* Quick commands */}
        {cur && (
          <div className="flex flex-wrap gap-1.5">
            {cur.subcommands.filter((s) => !s.startsWith('-')).map((s) => (
              <button key={s} onClick={() => setInput(s)} className="rounded-md border border-[var(--color-border-secondary)] px-2 py-0.5 text-[11px] text-[var(--color-text-secondary)] transition hover:border-[#bfdbfe] hover:text-[#1d4ed8]">{s}</button>
            ))}
          </div>
        )}

        {/* Command input */}
        <form onSubmit={(e) => { e.preventDefault(); void run() }} className="flex items-center gap-2 rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-3 py-2 font-mono text-xs">
          <span className="shrink-0 text-[var(--color-text-tertiary)]">{tool}</span>
          <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="infra status" spellCheck={false}
            className="min-w-0 flex-1 bg-transparent outline-none text-[var(--color-text-primary)]" />
          <button type="submit" disabled={running || !input.trim() || !cur?.installed}
            className="shrink-0 rounded-lg bg-[#1d4ed8] px-3 py-1 text-[11px] font-semibold text-white transition hover:bg-[#1e40af] disabled:opacity-50">
            {running ? 'Running…' : 'Run'}
          </button>
        </form>

        {/* Console */}
        {(log.length > 0 || running) && (
          <div className="overflow-hidden rounded-2xl border border-[var(--color-border-secondary)] bg-[#0b1020]">
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/60">Console</span>
              {exitCode != null && <span className={`text-[11px] font-semibold ${exitCode === 0 ? 'text-[#4ade80]' : 'text-[#f87171]'}`}>exit {exitCode}</span>}
            </div>
            <div ref={logRef} className="max-h-80 overflow-y-auto px-4 py-3 font-mono text-[11px] leading-relaxed text-white/80">
              {log.map((l, i) => <div key={i} className={l.startsWith('✗') ? 'text-[#f87171]' : l.startsWith('⚠') ? 'text-[#fbbf24]' : ''}>{l}</div>)}
              {running && <div className="text-white/40">…</div>}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
