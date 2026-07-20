'use client'

import { useEffect, useState } from 'react'
import { COMMAND_CENTERS } from './commandCenters'
import { loadNavPrefs, saveNavPrefs, type NavPrefs } from '@/lib/nav/navPrefs'

// Customize sidebar — reorder + hide the command centers in the rail. Changes persist immediately
// (saveNavPrefs fires noetica:navprefs-changed → the rail re-reads live). Workspace is the core surface
// and can be reordered but not hidden.
const PROTECTED = new Set(['workspace'])

export function CustomizeSidebarModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [prefs, setPrefs] = useState<NavPrefs>({ order: [], hidden: [] })
  useEffect(() => { if (open) setPrefs(loadNavPrefs()) }, [open])
  if (!open) return null

  // Full list in the user's order (hidden ones included + marked), so reorder + unhide both work here.
  const ordered = (() => {
    const seen = new Set<string>()
    const out: typeof COMMAND_CENTERS = []
    for (const id of prefs.order) { const c = COMMAND_CENTERS.find((x) => x.id === id); if (c && !seen.has(id)) { out.push(c); seen.add(id) } }
    for (const c of COMMAND_CENTERS) if (!seen.has(c.id)) { out.push(c); seen.add(c.id) }
    return out
  })()

  const persist = (next: NavPrefs) => { setPrefs(next); saveNavPrefs(next) }
  const toggleHidden = (id: string) => {
    if (PROTECTED.has(id)) return
    const hidden = prefs.hidden.includes(id) ? prefs.hidden.filter((h) => h !== id) : [...prefs.hidden, id]
    persist({ ...prefs, hidden })
  }
  const move = (i: number, dir: -1 | 1) => {
    const ids = ordered.map((c) => c.id)
    const j = i + dir
    if (j < 0 || j >= ids.length) return
    ;[ids[i], ids[j]] = [ids[j]!, ids[i]!]
    persist({ ...prefs, order: ids })
  }

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl border border-[var(--color-border-primary)] bg-[var(--color-background-primary)] shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-[var(--color-border-tertiary)] px-4 py-3">
          <div>
            <h2 className="text-[14px] font-semibold text-[var(--color-text-primary)]">Customize sidebar</h2>
            <p className="mt-0.5 text-[11px] text-[var(--color-text-tertiary)]">Reorder or hide the command centers.</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="flex h-6 w-6 items-center justify-center rounded-md text-[var(--color-text-tertiary)] transition hover:bg-[var(--color-background-secondary)] hover:text-[var(--color-text-primary)]">
            <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden><path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
          </button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto p-2">
          {ordered.map((c, i) => {
            const hidden = prefs.hidden.includes(c.id)
            const locked = PROTECTED.has(c.id)
            return (
              <div key={c.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 transition hover:bg-[var(--color-background-secondary)]">
                <div className="flex flex-col text-[var(--color-text-tertiary)]">
                  <button onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up" className="leading-none transition hover:text-[var(--color-text-primary)] disabled:opacity-25">
                    <svg width="12" height="8" viewBox="0 0 12 8" fill="none" aria-hidden><path d="M2 6l4-4 4 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  </button>
                  <button onClick={() => move(i, 1)} disabled={i === ordered.length - 1} aria-label="Move down" className="leading-none transition hover:text-[var(--color-text-primary)] disabled:opacity-25">
                    <svg width="12" height="8" viewBox="0 0 12 8" fill="none" aria-hidden><path d="M2 2l4 4 4-4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  </button>
                </div>
                <span className={`flex-1 text-[13px] ${hidden ? 'text-[var(--color-text-tertiary)] line-through' : 'text-[var(--color-text-primary)]'}`}>
                  {c.label}
                </span>
                <button
                  onClick={() => toggleHidden(c.id)}
                  disabled={locked}
                  title={locked ? 'Workspace can’t be hidden' : hidden ? 'Show' : 'Hide'}
                  className={`flex h-4 w-7 shrink-0 items-center rounded-full px-0.5 transition disabled:opacity-40 ${!hidden ? 'justify-end bg-[var(--color-accent)]' : 'justify-start bg-[var(--color-border-secondary)]'}`}
                >
                  <span className="h-3 w-3 rounded-full bg-white" />
                </button>
              </div>
            )
          })}
        </div>

        <div className="flex items-center justify-between border-t border-[var(--color-border-tertiary)] px-4 py-2.5">
          <button onClick={() => persist({ order: [], hidden: [] })} className="text-[12px] text-[var(--color-text-tertiary)] transition hover:text-[var(--color-text-secondary)]">Reset</button>
          <button onClick={onClose} className="rounded-lg bg-[var(--color-text-primary)] px-3 py-1.5 text-[12px] font-semibold text-[var(--color-background-primary)]">Done</button>
        </div>
      </div>
    </div>
  )
}
