'use client'

import { useState } from 'react'
import type { WorkspaceSession } from '@/lib/session/types'
import type { PublishResult } from '@/lib/session/commons-client'

/**
 * OpenChatToggle — the opt-in control that makes a chat part of the community commons (searchable by other users'
 * agents via SearXNG). PRIVATE by default; there is no default-open path. Opening runs the mandatory server-side
 * PII gate — the toggle only lands in the "open" state if the server accepted and indexed the redacted chat, and
 * it tells the user what was masked ("published — masked 3 items"). Ephemeral (security-lane) chats are hard-
 * disabled: that combination is a contradiction. Making a chat private revokes it from the index immediately.
 */
export function OpenChatToggle({ session, onSetVisibility }: {
  session: WorkspaceSession
  onSetVisibility: (id: string, v: 'private' | 'open') => Promise<PublishResult>
}) {
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [err, setErr] = useState('')
  const isOpen = session.visibility === 'open'
  const ephemeral = session.ephemeral === true

  async function toggle() {
    setErr(''); setNote(''); setBusy(true)
    try {
      const next = isOpen ? 'private' : 'open'
      const r = await onSetVisibility(session.id, next)
      if (!r.ok) { setErr(r.error ?? 'could not open this chat'); return }
      if (next === 'open') {
        const n = r.findings?.piiCount ?? 0
        const x = r.findings?.exfilUrls.length ?? 0
        setNote(n || x ? `Published — masked ${n} sensitive item${n === 1 ? '' : 's'}${x ? ` + ${x} link${x === 1 ? '' : 's'}` : ''} first.` : 'Published to the commons.')
      } else {
        setNote('Now private — removed from the commons.')
      }
    } finally { setBusy(false) }
  }

  if (ephemeral) {
    return (
      <span className="inline-flex items-center gap-1 rounded-lg border border-[var(--color-border-secondary)] px-2 py-0.5 text-[11px] text-[var(--color-text-tertiary)]" title="Security-lane chats are obliterated and can never be shared.">
        🔒 private · ephemeral
      </span>
    )
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        onClick={() => void toggle()}
        disabled={busy}
        title={isOpen
          ? 'This chat is in the community commons — other people’s agents can find it (redacted). Click to make private.'
          : 'Add this chat to the community commons so other people’s agents can find it. It’s redacted first; you can revoke anytime.'}
        className={`inline-flex items-center gap-1.5 rounded-lg border px-2 py-0.5 text-[11px] font-medium transition disabled:opacity-50 ${
          isOpen
            ? 'border-[#a7f3d0] bg-[#ecfdf5] text-[#047857] hover:bg-[#d1fae5]'
            : 'border-[var(--color-border-secondary)] text-[var(--color-text-secondary)] hover:bg-[var(--color-background-tertiary)]'
        }`}
      >
        {busy ? '…' : isOpen ? '🌐 open · in commons' : '🔒 private'}
      </button>
      {note && <span className="text-[11px] text-[var(--color-text-tertiary)]">{note}</span>}
      {err && <span className="text-[11px] text-[#dc2626]">{err}</span>}
    </span>
  )
}
