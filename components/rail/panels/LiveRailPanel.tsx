'use client'

// The Live panel — the transcript of a live (voice) conversation. Live is a *metachat*: it reads the
// active chat as context and can talk about it or answer alongside it, but it writes to its OWN store,
// never into the main stream. This panel shows that side-transcript while (and after) a session runs;
// "Commit to chat" is the only bridge — it copies one exchange into the real conversation.

export type LiveTurn = { id: string; role: 'user' | 'assistant'; content: string; committed?: boolean }

type Props = {
  turns: LiveTurn[]
  isLive?: boolean
  onCommit?: (assistantTurnId: string) => void
  onClear?: () => void
}

export function LiveRailPanel({ turns, isLive = false, onCommit, onClear }: Props) {
  if (turns.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-6 text-center">
        <span className="mb-2 flex h-8 w-8 items-center justify-center rounded-full border border-[var(--color-border-secondary)] text-[var(--color-text-tertiary)]">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
            <rect x="2.2" y="6" width="1.6" height="4" rx="0.8" fill="currentColor"/>
            <rect x="5.4" y="4" width="1.6" height="8" rx="0.8" fill="currentColor"/>
            <rect x="8.6" y="5" width="1.6" height="6" rx="0.8" fill="currentColor"/>
            <rect x="11.8" y="6.5" width="1.6" height="3" rx="0.8" fill="currentColor"/>
          </svg>
        </span>
        <p className="text-[12.5px] text-[var(--color-text-tertiary)]">
          {isLive
            ? 'Listening… speak, and it answers aloud. This side-conversation won’t touch your chat.'
            : 'Start a live conversation from the waveform button up top. It can talk about this chat — without changing it.'}
        </p>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto px-3 py-3">
      {/* Status line */}
      <div className="mb-2 flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-[11px] font-medium text-[var(--color-text-tertiary)]">
          <span className={`h-1.5 w-1.5 rounded-full ${isLive ? 'bg-[#4f46e5] animate-pulse' : 'bg-[var(--color-text-tertiary)]'}`} />
          {isLive ? 'Live — listening' : 'Live — ended'}
        </span>
        {onClear && <button onClick={onClear} className="text-[11px] text-[var(--color-text-tertiary)] transition hover:text-[var(--color-text-secondary)]">Clear</button>}
      </div>

      <div className="space-y-2.5">
        {turns.map((t) => (
          <div key={t.id} className={t.role === 'user' ? 'flex justify-end' : ''}>
            <div className={`max-w-[92%] ${t.role === 'user' ? '' : 'w-full'}`}>
              <div className={`rounded-xl px-2.5 py-1.5 text-[12.5px] leading-relaxed ${
                t.role === 'user'
                  ? 'bg-[var(--color-background-secondary)] text-[var(--color-text-primary)]'
                  : 'text-[var(--color-text-secondary)]'
              }`}>
                {t.content}
              </div>
              {/* Commit to chat — the ONE bridge into the real transcript. Assistant turns only. */}
              {t.role === 'assistant' && onCommit && (
                t.committed ? (
                  <span className="mt-0.5 inline-block px-1 text-[10.5px] text-[var(--color-accent)]">committed to chat</span>
                ) : (
                  <button
                    onClick={() => onCommit(t.id)}
                    title="Copy this exchange into the main chat"
                    className="mt-0.5 inline-flex items-center gap-1 rounded px-1 py-0.5 text-[10.5px] text-[var(--color-text-tertiary)] transition hover:text-[var(--color-accent)]"
                  >
                    <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden><path d="M2 6.5l2.5 2.5L10 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    Commit to chat
                  </button>
                )
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
