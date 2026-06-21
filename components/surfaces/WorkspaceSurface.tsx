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
    </div>
  )
}
