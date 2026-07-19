'use client'

import { useCallback, useEffect, useState } from 'react'
import { useSettings } from '@/lib/settings/context'
import { pickProjectRoot } from '@/lib/fs/projectRoot'

/**
 * "Point at a folder on my Mac → make it a Gitea repo." The seam the Source surface
 * was missing. Left pane = an in-app folder browser (backed by /api/forge/browse);
 * right pane = name/visibility + a streamed create-and-push (/api/forge/import-local).
 */

type BrowseEntry = { name: string; path: string; isGitRepo: boolean }
type BrowseResp = { path: string; parent: string | null; entries: BrowseEntry[] }

const amBase = () =>
  typeof window !== 'undefined' && (window as unknown as { __TAURI__?: unknown }).__TAURI__ ? 'http://127.0.0.1:8080' : ''

export function LocalGitImport({ onClose, onDone }: { onClose: () => void; onDone?: (r: { html_url: string }) => void }) {
  const { settings, update } = useSettings()
  const configured = Boolean(settings.giteaEndpoint?.trim())

  const [browse, setBrowse] = useState<BrowseResp | null>(null)
  const [browseErr, setBrowseErr] = useState('')
  const [selected, setSelected] = useState<string>('')
  const [name, setName] = useState('')
  const [isPrivate, setIsPrivate] = useState(true)
  const [log, setLog] = useState<string[]>([])
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<{ html_url: string } | null>(null)

  const loadDir = useCallback(async (dir?: string) => {
    setBrowseErr('')
    try {
      const res = await fetch(`${amBase()}/api/forge/browse`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ dir }),
      })
      const data = (await res.json()) as BrowseResp & { error?: string }
      if (!res.ok || data.error) throw new Error(data.error || 'browse failed')
      setBrowse(data)
    } catch (e) {
      setBrowseErr(e instanceof Error ? e.message : 'Could not read folder — is the agent-machine backend running?')
    }
  }, [])

  // Start from the granted project root (picked once, persisted) so browsing stays
  // within it and never re-triggers a permission prompt. Falls back to home if unset.
  useEffect(() => { void loadDir(settings.projectRoot || undefined) }, [loadDir, settings.projectRoot])

  // Let the user (re)choose the project root; persist it and browse there.
  async function chooseRoot() {
    const root = await pickProjectRoot()
    if (root) { update({ projectRoot: root }); void loadDir(root) }
  }

  function pick(p: string) {
    setSelected(p)
    setName(p.split('/').filter(Boolean).pop() || '')
    setResult(null)
    setLog([])
  }

  async function start() {
    if (!selected || !name.trim() || running) return
    setRunning(true); setResult(null); setLog([])
    try {
      const res = await fetch(`${amBase()}/api/forge/import-local`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          localPath: selected, name: name.trim(), private: isPrivate,
          giteaBase: settings.giteaEndpoint, token: settings.giteaToken,
        }),
      })
      if (!res.ok || !res.body) throw new Error('import failed to start')
      const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = ''
      for (;;) {
        const { done, value } = await reader.read(); if (done) break
        buf += dec.decode(value, { stream: true }); const lines = buf.split('\n'); buf = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data:')) continue
          try {
            const ev = JSON.parse(line.slice(5)) as { label?: string; error?: string; html_url?: string; branch?: string }
            if (ev.error) setLog((l) => [...l, `✗ ${ev.error}`])
            else if (ev.html_url && ev.branch) { setResult({ html_url: ev.html_url }); setLog((l) => [...l, `✓ pushed ${ev.branch} → ${ev.html_url}`]); onDone?.({ html_url: ev.html_url }) }
            else if (ev.html_url) setLog((l) => [...l, `· created ${ev.html_url}`])
            else if (ev.label) setLog((l) => [...l, `· ${ev.label}`])
          } catch { /* skip */ }
        }
      }
    } catch (e) {
      setLog((l) => [...l, `✗ ${e instanceof Error ? e.message : 'import failed'}`])
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="flex max-h-[80vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--color-border-secondary)] px-5 py-3">
          <div>
            <div className="text-sm font-semibold text-[var(--color-text-primary)]">Add a local repo to Gitea Sovereign</div>
            <div className="text-[11px] text-[var(--color-text-tertiary)]">Pick a folder on this machine — it becomes a sovereign repo.</div>
          </div>
          <button onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--color-text-tertiary)] transition hover:bg-[var(--color-background-secondary)] hover:text-[var(--color-text-primary)]">
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden><path d="M3 3l7 7M10 3l-7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
          </button>
        </div>

        {!configured ? (
          <div className="px-5 py-8 text-center">
            <div className="text-sm text-[var(--color-text-secondary)]">No Gitea endpoint configured.</div>
            <div className="mt-1 text-[11px] text-[var(--color-text-tertiary)]">Set your Gitea URL + token in <strong>Settings → Connections</strong>, then bring Gitea up locally.</div>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1">
            {/* Folder browser */}
            <div className="flex w-1/2 min-w-0 flex-col border-r border-[var(--color-border-secondary)]">
              <div className="flex items-center gap-1.5 border-b border-[var(--color-border-secondary)] px-3 py-2">
                <button
                  onClick={() => browse?.parent && loadDir(browse.parent)}
                  disabled={!browse?.parent}
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-[var(--color-border-secondary)] text-[var(--color-text-secondary)] transition hover:bg-[var(--color-background-secondary)] disabled:opacity-40"
                  title="Up"
                >
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden><path d="M6 9V3M3 6l3-3 3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </button>
                <div className="min-w-0 flex-1 truncate text-[11px] text-[var(--color-text-tertiary)]" title={browse?.path}>{browse?.path ?? '…'}</div>
                <button
                  onClick={() => void chooseRoot()}
                  className="shrink-0 rounded-md border border-[var(--color-border-secondary)] px-2 py-0.5 text-[10px] font-medium text-[var(--color-text-secondary)] transition hover:bg-[var(--color-background-secondary)]"
                  title="Pick a project root once — Noetica remembers it and won't re-prompt"
                >
                  Choose root…
                </button>
                <button
                  onClick={() => browse && pick(browse.path)}
                  disabled={!browse}
                  className="shrink-0 rounded-md border border-[#bfdbfe] bg-[#eff6ff] px-2 py-0.5 text-[10px] font-semibold text-[#1d4ed8] transition hover:bg-[#dbeafe] disabled:opacity-40"
                >
                  Use this folder
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
                {browseErr ? (
                  <div className="m-2 rounded-lg border border-[#fecaca] bg-[#fef2f2] px-3 py-2 text-[11px] text-[#dc2626]">{browseErr}</div>
                ) : !browse ? (
                  <div className="p-3 text-[11px] text-[var(--color-text-tertiary)]">Loading…</div>
                ) : browse.entries.length === 0 ? (
                  <div className="p-3 text-[11px] text-[var(--color-text-tertiary)]">No subfolders.</div>
                ) : (
                  browse.entries.map((e) => (
                    <div key={e.path} className={`group flex items-center gap-1.5 rounded-lg px-2 py-1.5 ${selected === e.path ? 'bg-[#dbeafe]' : 'hover:bg-[var(--color-background-secondary)]'}`}>
                      <button onClick={() => loadDir(e.path)} className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
                        <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden className="shrink-0 text-[var(--color-text-tertiary)]"><path d="M1.5 3.5A1 1 0 0 1 2.5 2.5h3l1.3 1.3h5.7a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-7Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" /></svg>
                        <span className="truncate text-[11px] text-[var(--color-text-primary)]">{e.name}</span>
                        {e.isGitRepo && <span className="shrink-0 rounded bg-[var(--color-accent-bg)] px-1 py-px text-[8px] font-semibold text-[var(--color-accent)]">git</span>}
                      </button>
                      <button onClick={() => pick(e.path)} className="shrink-0 rounded border border-[#bfdbfe] bg-[#eff6ff] px-1.5 py-0.5 text-[9px] font-semibold text-[#1d4ed8] opacity-0 transition group-hover:opacity-100 hover:bg-[#dbeafe]">Select</button>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Import form */}
            <div className="flex w-1/2 min-w-0 flex-col p-4">
              {!selected ? (
                <div className="m-auto text-center text-[11px] text-[var(--color-text-tertiary)]">Select a folder to import.</div>
              ) : (
                <div className="space-y-3">
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">Local folder</div>
                    <div className="mt-0.5 truncate rounded-lg bg-[var(--color-background-secondary)] px-2.5 py-1.5 text-[11px] text-[var(--color-text-secondary)]" title={selected}>{selected}</div>
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">Repository name</label>
                    <input value={name} onChange={(e) => setName(e.target.value)} className="mt-0.5 w-full rounded-lg border border-[#bfdbfe] bg-[var(--color-background-secondary)] px-2.5 py-1.5 text-xs outline-none focus:border-[#1d4ed8] focus:bg-[var(--color-background-primary)]" />
                  </div>
                  <label className="flex items-center gap-2 text-[11px] text-[var(--color-text-secondary)]">
                    <input type="checkbox" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} />
                    Private repository
                  </label>
                  <button
                    onClick={() => void start()}
                    disabled={running || !name.trim()}
                    className="w-full rounded-xl bg-[#1d4ed8] px-3 py-2 text-xs font-semibold text-white transition hover:bg-[#1e40af] disabled:opacity-50"
                  >
                    {running ? 'Importing…' : result ? 'Import again' : 'Create in Gitea & push'}
                  </button>

                  {(log.length > 0 || result) && (
                    <div className="max-h-40 overflow-y-auto rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] p-2 font-mono text-[10px] leading-relaxed text-[var(--color-text-secondary)]">
                      {log.map((l, i) => <div key={i} className={l.startsWith('✗') ? 'text-[#dc2626]' : l.startsWith('✓') ? 'text-[var(--color-accent)]' : ''}>{l}</div>)}
                    </div>
                  )}
                  {result && (
                    <a href={result.html_url} target="_blank" rel="noopener" className="block rounded-lg border border-[#bbf7d0] bg-[var(--color-accent-bg)] px-3 py-2 text-center text-[11px] font-semibold text-[var(--color-accent)] transition hover:bg-[var(--color-accent-bg)]">
                      Open {result.html_url.split('/').slice(-2).join('/')} ↗
                    </a>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
