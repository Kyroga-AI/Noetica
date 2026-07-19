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
interface Diff { path: string; before: string | null; after: string | null; isNew: boolean }

// Compact LCS line diff — enough for the small files the solve loop produces. Capped so a
// pathological large file can't lock the UI.
function lineDiff(before: string, after: string): { t: 'ctx' | 'add' | 'del'; s: string }[] {
  const a = (before ?? '').split('\n').slice(0, 600), b = (after ?? '').split('\n').slice(0, 600)
  const n = a.length, m = b.length
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!)
  const out: { t: 'ctx' | 'add' | 'del'; s: string }[] = []
  let i = 0, j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push({ t: 'ctx', s: a[i]! }); i++; j++ }
    else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) { out.push({ t: 'del', s: a[i]! }); i++ }
    else { out.push({ t: 'add', s: b[j]! }); j++ }
  }
  while (i < n) { out.push({ t: 'del', s: a[i]! }); i++ }
  while (j < m) { out.push({ t: 'add', s: b[j]! }); j++ }
  return out
}

type DiffLine = { t: 'ctx' | 'add' | 'del'; s: string }
type Seg = { kind: 'ctx'; s: string } | { kind: 'hunk'; id: number; lines: DiffLine[] }
// Group a line diff into HUNKS (consecutive add/del runs) so each change can be accepted or
// rejected on its own — finer-grained than whole-file accept/reject.
function buildHunks(lines: DiffLine[]): Seg[] {
  const out: Seg[] = []
  let cur: DiffLine[] | null = null
  let hid = 0
  for (const l of lines) {
    if (l.t === 'ctx') {
      if (cur) { out.push({ kind: 'hunk', id: hid++, lines: cur }); cur = null }
      out.push({ kind: 'ctx', s: l.s })
    } else { (cur ??= []).push(l) }
  }
  if (cur) out.push({ kind: 'hunk', id: hid++, lines: cur })
  return out
}
// Reconstruct the file applying only the ACCEPTED hunks: accepted → keep the new (add) lines;
// rejected → keep the original (del) lines. Context is always kept.
function reconstruct(lines: DiffLine[], rejected: Set<number>): string {
  const out: string[] = []
  for (const seg of buildHunks(lines)) {
    if (seg.kind === 'ctx') { out.push(seg.s); continue }
    const rej = rejected.has(seg.id)
    for (const l of seg.lines) {
      if (l.t === 'add' && !rej) out.push(l.s)
      if (l.t === 'del' && rej) out.push(l.s)
    }
  }
  return out.join('\n')
}

// ── NERDTree-style file tree ────────────────────────────────────────────────
interface TreeNode { name: string; path: string; dir: boolean; children: TreeNode[] }

/** Build a nested folder tree from the flat path list (folders implied by file paths). */
function buildTree(files: FileEntry[]): TreeNode[] {
  const root: TreeNode = { name: '', path: '', dir: true, children: [] }
  for (const f of files.filter((x) => !x.dir)) {
    const parts = f.path.split('/').filter(Boolean)
    let cur = root
    parts.forEach((part, i) => {
      const path = parts.slice(0, i + 1).join('/')
      let child = cur.children.find((c) => c.name === part)
      if (!child) { child = { name: part, path, dir: i < parts.length - 1, children: [] }; cur.children.push(child) }
      cur = child
    })
  }
  const sort = (n: TreeNode) => { n.children.sort((a, b) => (Number(b.dir) - Number(a.dir)) || a.name.localeCompare(b.name)); n.children.forEach(sort) }
  sort(root)
  return root.children
}
const allDirPaths = (nodes: TreeNode[], acc: string[] = []): string[] => {
  for (const n of nodes) if (n.dir) { acc.push(n.path); allDirPaths(n.children, acc) }
  return acc
}
const EXT_TINT: Record<string, string> = {
  ts: '#3178c6', tsx: '#3178c6', js: '#f1d000', jsx: '#f1d000', json: '#a0a0a0', py: '#3572a5',
  rs: '#dea584', go: '#00add8', md: '#6b7280', sh: '#89e051', css: '#563d7c', html: '#e34c26', toml: '#9c4221', yaml: '#cb171e', yml: '#cb171e',
}
function FileGlyph({ name }: { name: string }) {
  const ext = name.split('.').pop() ?? ''
  const tint = EXT_TINT[ext.toLowerCase()] ?? 'var(--color-text-tertiary)'
  return (
    <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden className="shrink-0">
      <path d="M3 1.5h5l3 3V12a.5.5 0 0 1-.5.5h-7A.5.5 0 0 1 3 12V2a.5.5 0 0 1 .5-.5Z" stroke={tint} strokeWidth="1.1" strokeLinejoin="round" />
      <path d="M8 1.5v3h3" stroke={tint} strokeWidth="1.1" strokeLinejoin="round" />
    </svg>
  )
}

function FileTreeNode({ node, depth, sel, onOpen, expanded, toggle }: {
  node: TreeNode; depth: number; sel: string; onOpen: (p: string) => void
  expanded: Set<string>; toggle: (p: string) => void
}) {
  if (node.dir) {
    const open = expanded.has(node.path)
    return (
      <div>
        <button onClick={() => toggle(node.path)} style={{ paddingLeft: 8 + depth * 12 }}
          className="flex w-full items-center gap-1.5 py-1 pr-3 text-left text-[12px] text-[var(--color-text-secondary)] transition hover:bg-[var(--color-background-tertiary)]">
          <svg width="9" height="9" viewBox="0 0 9 9" fill="none" aria-hidden className="shrink-0 text-[var(--color-text-tertiary)]"
            style={{ transform: open ? 'rotate(90deg)' : undefined, transition: 'transform 0.1s' }}>
            <path d="M2.5 1.5l3 3-3 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden className="shrink-0 text-[#d9a441]">
            <path d="M1.5 3.5a1 1 0 0 1 1-1h2.5l1.2 1.2H11.5a1 1 0 0 1 1 1V11a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1V3.5Z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
          </svg>
          <span className="truncate font-medium">{node.name}</span>
        </button>
        {open && node.children.map((c) => (
          <FileTreeNode key={c.path} node={c} depth={depth + 1} sel={sel} onOpen={onOpen} expanded={expanded} toggle={toggle} />
        ))}
      </div>
    )
  }
  return (
    <button onClick={() => onOpen(node.path)} style={{ paddingLeft: 8 + depth * 12 }}
      className={`flex w-full items-center gap-1.5 py-1 pr-3 text-left text-[12px] transition ${sel === node.path ? 'bg-[#dbeafe] text-[#1d4ed8]' : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-background-tertiary)]'}`}>
      <span className="w-[9px] shrink-0" />
      <FileGlyph name={node.name} />
      <span className="truncate">{node.name}</span>
    </button>
  )
}

export function WorkspaceSurface() {
  const [workspaces, setWorkspaces] = useState<string[]>([])
  const [ws, setWs] = useState<string>('')
  const [files, setFiles] = useState<FileEntry[]>([])
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set())
  const [sel, setSel] = useState<string>('')
  const [content, setContent] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [term, setTerm] = useState<{ cmd: string; out: string }[]>([])
  const [cmd, setCmd] = useState('')
  const [running, setRunning] = useState(false)

  const [task, setTask] = useState('')
  const [solving, setSolving] = useState(false)
  const [steps, setSteps] = useState<{ attempt: number; verify: string; exit: string; ok: boolean; files: string[]; output: string }[]>([])
  const [solved, setSolved] = useState<boolean | null>(null)
  const [diffs, setDiffs] = useState<Diff[]>([])
  const [reviewed, setReviewed] = useState<Record<string, 'accepted' | 'rejected'>>({})
  const [rejectedHunks, setRejectedHunks] = useState<Record<string, number[]>>({})  // path → rejected hunk ids
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  async function rejectFile(d: Diff) {
    try {
      await fetch(`${amBase()}/api/workspace/write`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ws, path: d.path, content: d.before ?? '', delete: d.isNew }),
        signal: AbortSignal.timeout(8000),
      })
      setReviewed((r) => ({ ...r, [d.path]: 'rejected' }))
      void loadFiles(ws)
      if (sel === d.path) { setSel(''); setContent('') }
    } catch { /* offline */ }
  }
  function acceptFile(d: Diff) { setReviewed((r) => ({ ...r, [d.path]: 'accepted' })) }
  const toggleHunk = (path: string, id: number) =>
    setRejectedHunks((r) => { const cur = new Set(r[path] ?? []); cur.has(id) ? cur.delete(id) : cur.add(id); return { ...r, [path]: [...cur] } })
  // Apply only the accepted hunks — write the reconstructed file (rejected hunks reverted).
  async function applyHunks(d: Diff) {
    const rejected = new Set(rejectedHunks[d.path] ?? [])
    const content = reconstruct(lineDiff(d.before ?? '', d.after ?? ''), rejected)
    try {
      await fetch(`${amBase()}/api/workspace/write`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ws, path: d.path, content }),
        signal: AbortSignal.timeout(8000),
      })
      setReviewed((r) => ({ ...r, [d.path]: 'accepted' }))
      void loadFiles(ws)
      if (sel === d.path) void openFile(d.path)
    } catch { /* offline */ }
  }

  async function runSolve() {
    const t = task.trim()
    if (!t || !ws || solving) return
    setSolving(true); setSteps([]); setSolved(null); setDiffs([]); setReviewed({}); setExpanded({})
    try {
      const r = await fetch(`${amBase()}/api/code/solve`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ task: t, workspace: ws, max_attempts: 4 }),
        signal: AbortSignal.timeout(600_000),
      })
      const j = (await r.json()) as { solved?: boolean; steps?: typeof steps; diffs?: Diff[] }
      setSteps(j.steps ?? []); setSolved(j.solved ?? false); setDiffs(j.diffs ?? [])
      void loadFiles(ws)
    } catch {
      setSolved(false); setSteps([{ attempt: 1, verify: '', exit: 'error', ok: false, files: [], output: 'backend offline or timed out' }])
    } finally { setSolving(false) }
  }

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
      const fs = (j.files ?? []).filter((f) => !f.dir)
      setFiles(fs)
      setExpandedDirs(new Set(allDirPaths(buildTree(fs))))   // NERDTree: folders open by default
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
      {/* Build — describe a task; the verify-repair loop generates → runs the test → repairs. */}
      <div className="flex items-center gap-2 border-b border-[var(--color-border-tertiary)] bg-[var(--color-background-primary)] px-6 py-2">
        <span className="text-[11px] font-medium text-[#7c3aed]">Build</span>
        <input
          value={task} onChange={(e) => setTask(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void runSolve() }}
          placeholder={ws ? 'describe what to build — e.g. "fib.py with a test that asserts fib(10)==55"' : 'pick a workspace first'}
          disabled={!ws || solving}
          className="flex-1 rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] px-2.5 py-1 text-[12px] text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-tertiary)]"
        />
        <button onClick={() => void runSolve()} disabled={!ws || solving || !task.trim()}
          className="rounded-lg bg-[#7c3aed] px-3 py-1 text-[12px] font-semibold text-white disabled:opacity-50">
          {solving ? 'Building…' : 'Build →'}
        </button>
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="w-64 shrink-0 overflow-y-auto border-r border-[var(--color-border-tertiary)] bg-[var(--color-background-secondary)] py-2">
          {loading && <div className="px-4 py-2 text-[12px] text-[var(--color-text-tertiary)]">loading…</div>}
          {!loading && files.length === 0 && <div className="px-4 py-2 text-[12px] text-[var(--color-text-tertiary)]">Empty — ask the agent to build something (it scaffolds into a workspace).</div>}
          {!loading && buildTree(files).map((node) => (
            <FileTreeNode key={node.path} node={node} depth={0} sel={sel} onOpen={(p) => void openFile(p)}
              expanded={expandedDirs}
              toggle={(p) => setExpandedDirs((cur) => { const n = new Set(cur); if (n.has(p)) n.delete(p); else n.add(p); return n })} />
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-auto bg-[var(--color-background-primary)]">
          {!sel && steps.length === 0 && diffs.length === 0 && <div className="flex h-full items-center justify-center text-[13px] text-[var(--color-text-tertiary)]">Select a file, or describe a build above.</div>}
          {!sel && diffs.length > 0 && (
            <div className="p-4">
              <div className="mb-3 flex items-center gap-2 text-[13px] font-semibold text-[var(--color-text-primary)]">
                <span>{solved ? '✅' : '⚠️'} Review changes</span>
                <span className="text-[11px] font-normal text-[var(--color-text-tertiary)]">{diffs.length} file{diffs.length > 1 ? 's' : ''} · accept or reject each</span>
              </div>
              {diffs.map((d) => {
                const status = reviewed[d.path]
                const lines = lineDiff(d.before ?? '', d.after ?? '')
                const adds = lines.filter((l) => l.t === 'add').length, dels = lines.filter((l) => l.t === 'del').length
                const open = expanded[d.path] ?? true
                const segs = buildHunks(lines)
                const rej = new Set(rejectedHunks[d.path] ?? [])
                const hunkCount = segs.filter((s) => s.kind === 'hunk').length
                return (
                  <div key={d.path} className="mb-2 overflow-hidden rounded-xl border border-[var(--color-border-tertiary)] bg-[var(--color-background-secondary)]">
                    <div className="flex items-center gap-2 px-3 py-2 text-[12px]">
                      <button onClick={() => setExpanded((e) => ({ ...e, [d.path]: !open }))} className="text-[var(--color-text-tertiary)]">{open ? '▾' : '▸'}</button>
                      <span className="font-mono text-[var(--color-text-primary)]">{d.path}</span>
                      {d.isNew && <span className="rounded bg-[var(--color-accent-bg)] px-1 text-[10px] text-[var(--color-accent)]">new</span>}
                      <span className="text-[10px] text-[var(--color-accent)]">+{adds}</span><span className="text-[10px] text-[#dc2626]">−{dels}</span>
                      {hunkCount > 1 && <span className="text-[10px] text-[var(--color-text-tertiary)]">{hunkCount} hunks</span>}
                      <div className="ml-auto flex items-center gap-1.5">
                        {status === 'accepted' && <span className="text-[11px] text-[var(--color-accent)]">✓ accepted</span>}
                        {status === 'rejected' && <span className="text-[11px] text-[#b91c1c]">⟲ reverted</span>}
                        {!status && (<>
                          {rej.size > 0 && <button onClick={() => void applyHunks(d)} className="rounded bg-[#1d4ed8] px-2 py-0.5 text-[11px] font-semibold text-white">Apply {hunkCount - rej.size}/{hunkCount}</button>}
                          <button onClick={() => acceptFile(d)} className="rounded bg-[var(--color-accent)] px-2 py-0.5 text-[11px] font-semibold text-white">Accept all</button>
                          <button onClick={() => void rejectFile(d)} className="rounded border border-[#dc2626] px-2 py-0.5 text-[11px] font-semibold text-[#dc2626]">Reject all</button>
                        </>)}
                      </div>
                    </div>
                    {open && (
                      <pre className="max-h-72 overflow-auto border-t border-[var(--color-border-tertiary)] bg-[var(--color-background-primary)] px-3 py-2 font-mono text-[11px] leading-relaxed">
                        {segs.map((seg, si) => seg.kind === 'ctx' ? (
                          <div key={si} className="text-[var(--color-text-secondary)]"><span className="select-none opacity-50">  </span>{seg.s || ' '}</div>
                        ) : (
                          <div key={si} className={`group relative my-0.5 rounded border-l-2 pl-1 ${rej.has(seg.id) ? 'border-[#9ca3af] opacity-50' : 'border-[var(--color-accent)]'}`}>
                            {!status && (
                              <button onClick={() => toggleHunk(d.path, seg.id)} title={rej.has(seg.id) ? 'keep this change' : 'reject this hunk'}
                                className="absolute right-1 top-0 z-10 hidden rounded bg-[var(--color-background-secondary)] px-1 text-[9px] text-[var(--color-text-tertiary)] transition group-hover:block hover:text-[#dc2626]">
                                {rej.has(seg.id) ? 'restore' : 'reject hunk'}
                              </button>
                            )}
                            {seg.lines.map((l, i) => (
                              <div key={i} className={l.t === 'add' ? `bg-[var(--color-accent)]/10 text-[var(--color-accent)] ${rej.has(seg.id) ? 'line-through' : ''}` : 'bg-[#dc2626]/10 text-[#b91c1c]'}>
                                <span className="select-none opacity-50">{l.t === 'add' ? '+' : '−'} </span>{l.s || ' '}
                              </div>
                            ))}
                          </div>
                        ))}
                      </pre>
                    )}
                  </div>
                )
              })}
            </div>
          )}
          {!sel && steps.length > 0 && (
            <div className="p-4">
              <div className="mb-3 text-[13px] font-semibold text-[var(--color-text-primary)]">{solving ? '⏳ Building…' : solved ? '✅ Built & verified' : '⚠️ Needs another pass'}</div>
              {steps.map((s, i) => (
                <div key={i} className="mb-2 rounded-xl border border-[var(--color-border-tertiary)] bg-[var(--color-background-secondary)] p-2.5 text-[12px]">
                  <div className="font-medium text-[var(--color-text-primary)]">{s.ok ? '✅' : '❌'} attempt {s.attempt} <span className="text-[var(--color-text-tertiary)]">· exit {s.exit}</span></div>
                  {s.files.length > 0 && (
                    <div className="mt-1 text-[var(--color-text-tertiary)]">files: {s.files.map((f, k) => (
                      <button key={f} onClick={() => void openFile(f)} className="text-[#1d4ed8] underline">{f}{k < s.files.length - 1 ? ', ' : ''}</button>
                    ))}</div>
                  )}
                  {s.verify && <div className="mt-1 font-mono text-[11px] text-[var(--color-text-tertiary)]">verify: {s.verify}</div>}
                  {s.output && !s.ok && <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap rounded bg-[var(--color-background-primary)] p-1.5 font-mono text-[11px] text-[var(--color-text-secondary)]">{s.output.slice(0, 500)}</pre>}
                </div>
              ))}
            </div>
          )}
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
