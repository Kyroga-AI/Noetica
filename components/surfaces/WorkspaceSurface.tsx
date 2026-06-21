'use client'

/**
 * WorkspaceSurface — a code workspace view over the agent's project workspaces
 * (~/.noetica/workspaces). File tree + viewer, so when the agent scaffolds/builds/edits
 * (run_command, scaffold, the verify-repair loop), you SEE the files it created and can browse
 * them. The first step toward a Claude-Code-style coding surface (diffs/terminal/apply next).
 */
import { useEffect, useState } from 'react'
import { isTauri } from '@/lib/tauri/bridge'

function amBase(): string { return isTauri() ? 'http://127.0.0.1:8080' : '' }
interface FileEntry { path: string; dir: boolean; size: number }

export function WorkspaceSurface() {
  const [workspaces, setWorkspaces] = useState<string[]>([])
  const [ws, setWs] = useState<string>('')
  const [files, setFiles] = useState<FileEntry[]>([])
  const [sel, setSel] = useState<string>('')
  const [content, setContent] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [term, setTerm] = useState<{ cmd: string; out: string }[]>([])
  const [cmd, setCmd] = useState('')
  const [running, setRunning] = useState(false)

  async function runCmd() {
    const c = cmd.trim()
    if (!c || !ws || running) return
    setCmd(''); setRunning(true)
    setTerm((t) => [...t, { cmd: c, out: '…running' }])
    try {
      const r = await fetch(`${amBase()}/api/tool`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'run_command', input: { command: c, workspace: ws } }),
        signal: AbortSignal.timeout(300_000),
      })
      const j = (await r.json()) as { result?: string }
      setTerm((t) => t.map((e, i) => (i === t.length - 1 ? { ...e, out: j.result ?? '(no output)' } : e)))
      void loadFiles(ws)  // a command may have created/changed files
    } catch {
      setTerm((t) => t.map((e, i) => (i === t.length - 1 ? { ...e, out: '(command failed / backend offline)' } : e)))
    } finally { setRunning(false) }
  }

  async function loadWorkspaces() {
    try {
      const r = await fetch(`${amBase()}/api/workspace/list`, { signal: AbortSignal.timeout(8000) })
      const j = (await r.json()) as { workspaces?: string[] }
      setWorkspaces(j.workspaces ?? [])
      if (!ws && j.workspaces?.length) setWs(j.workspaces[0]!)
    } catch { /* offline */ }
  }
  async function loadFiles(name: string) {
    setLoading(true)
    try {
      const r = await fetch(`${amBase()}/api/workspace/list?ws=${encodeURIComponent(name)}`, { signal: AbortSignal.timeout(8000) })
      const j = (await r.json()) as { files?: FileEntry[] }
      setFiles((j.files ?? []).filter((f) => !f.dir))
    } catch { setFiles([]) } finally { setLoading(false) }
  }
  async function openFile(p: string) {
    setSel(p); setContent('…')
    try {
      const r = await fetch(`${amBase()}/api/workspace/read?ws=${encodeURIComponent(ws)}&path=${encodeURIComponent(p)}`, { signal: AbortSignal.timeout(8000) })
      const j = (await r.json()) as { content?: string; error?: string }
      setContent(j.content ?? `(${j.error ?? 'could not read'})`)
    } catch { setContent('(could not read)') }
  }

  useEffect(() => { void loadWorkspaces() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (ws) { void loadFiles(ws); setSel(''); setContent('') } }, [ws]) // eslint-disable-line react-hooks/exhaustive-deps

  const lang = sel.split('.').pop() ?? ''
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex items-center gap-3 border-b border-[var(--color-border-tertiary)] bg-[var(--color-background-secondary)] px-6 py-3">
        <span className="text-[13px] font-semibold text-[var(--color-text-primary)]">Workspace</span>
        <select value={ws} onChange={(e) => setWs(e.target.value)}
          className="rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-2 py-1 text-[12px] text-[var(--color-text-primary)]">
          {workspaces.length === 0 && <option value="">no projects yet</option>}
          {workspaces.map((w) => <option key={w} value={w}>{w}</option>)}
        </select>
        <button onClick={() => { void loadWorkspaces(); if (ws) void loadFiles(ws) }} className="text-[11px] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]">↻ refresh</button>
        <span className="ml-auto text-[11px] text-[var(--color-text-tertiary)]">{files.length} files</span>
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="w-64 shrink-0 overflow-y-auto border-r border-[var(--color-border-tertiary)] bg-[var(--color-background-secondary)] py-2">
          {loading && <div className="px-4 py-2 text-[12px] text-[var(--color-text-tertiary)]">loading…</div>}
          {!loading && files.length === 0 && <div className="px-4 py-2 text-[12px] text-[var(--color-text-tertiary)]">Empty — ask the agent to build something (it scaffolds into a workspace).</div>}
          {files.map((f) => {
            const depth = f.path.split('/').length - 1
            const name = f.path.split('/').pop()
            return (
              <button key={f.path} onClick={() => void openFile(f.path)}
                style={{ paddingLeft: 12 + depth * 12 }}
                className={`block w-full truncate py-1 pr-3 text-left text-[12px] transition ${sel === f.path ? 'bg-[#dbeafe] text-[#1d4ed8]' : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-background-tertiary)]'}`}>
                <span className="text-[var(--color-text-tertiary)]">{depth > 0 ? '· ' : ''}</span>{name}
              </button>
            )
          })}
        </div>
        <div className="min-h-0 flex-1 overflow-auto bg-[var(--color-background-primary)]">
          {!sel && <div className="flex h-full items-center justify-center text-[13px] text-[var(--color-text-tertiary)]">Select a file to view it.</div>}
          {sel && (
            <>
              <div className="sticky top-0 border-b border-[var(--color-border-tertiary)] bg-[var(--color-background-secondary)] px-4 py-1.5 font-mono text-[11px] text-[var(--color-text-secondary)]">{sel} <span className="ml-1 text-[var(--color-text-tertiary)]">· {lang}</span></div>
              <pre className="overflow-auto px-4 py-3 font-mono text-[12px] leading-relaxed text-[var(--color-text-primary)]"><code>{content}</code></pre>
            </>
          )}
        </div>
      </div>
      {/* Terminal — run commands in the selected workspace and watch the output. */}
      <div className="flex h-52 shrink-0 flex-col border-t border-[var(--color-border-tertiary)] bg-[#0b0f17]">
        <div className="flex items-center justify-between border-b border-[var(--color-border-tertiary)] px-3 py-1">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-[#94a3b8]">Terminal · {ws || '(no workspace)'}</span>
          {term.length > 0 && <button onClick={() => setTerm([])} className="text-[10px] text-[#64748b] hover:text-[#94a3b8]">clear</button>}
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-3 py-2 font-mono text-[11px] leading-relaxed text-[#cbd5e1]">
          {term.length === 0 && <div className="text-[#475569]">Run a command in this workspace — e.g. <span className="text-[#94a3b8]">npm run build</span>, <span className="text-[#94a3b8]">ls -la</span>, <span className="text-[#94a3b8]">git status</span>.</div>}
          {term.map((e, i) => (
            <div key={i} className="mb-1.5">
              <div className="text-[#34d399]">$ {e.cmd}</div>
              <pre className="whitespace-pre-wrap text-[#cbd5e1]">{e.out}</pre>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2 border-t border-[var(--color-border-tertiary)] px-3 py-1.5">
          <span className="font-mono text-[12px] text-[#34d399]">$</span>
          <input
            value={cmd} onChange={(e) => setCmd(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void runCmd() }}
            placeholder={ws ? 'command…' : 'pick a workspace first'} disabled={!ws || running}
            className="flex-1 bg-transparent font-mono text-[12px] text-[#e2e8f0] outline-none placeholder:text-[#475569]"
          />
          {running && <span className="h-3 w-3 animate-spin rounded-full border-2 border-[#34d399] border-t-transparent" />}
        </div>
      </div>
    </div>
  )
}
