'use client'

/**
 * Route-segment error boundary. Without this, a render throw anywhere in the tree white-screens the whole app.
 * Catches it, shows a recoverable panel, and lets the user reset the segment or reload.
 */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-[var(--color-background-primary)] p-8">
      <div className="max-w-md rounded-2xl border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] p-6 text-center shadow-xl">
        <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-[#fef2f2]">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden><path d="M12 8v5M12 16v.5M12 3l9 16H3l9-16Z" stroke="#dc2626" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </div>
        <div className="text-sm font-semibold text-[var(--color-text-primary)]">Something broke in this view</div>
        <p className="mt-1 text-xs text-[var(--color-text-secondary)]">The rest of the app is fine. Try again, or reload.</p>
        {error?.message && <pre className="mt-3 max-h-24 overflow-auto rounded-lg bg-[var(--color-background-primary)] p-2 text-left text-[10px] text-[var(--color-text-tertiary)]">{error.message.slice(0, 300)}</pre>}
        <div className="mt-4 flex justify-center gap-2">
          <button onClick={reset} className="rounded-xl bg-[#1d4ed8] px-4 py-2 text-xs font-semibold text-white transition hover:bg-[#1e40af]">Try again</button>
          <button onClick={() => location.reload()} className="rounded-xl border border-[var(--color-border-secondary)] px-4 py-2 text-xs font-medium text-[var(--color-text-secondary)] transition hover:bg-[var(--color-background-tertiary)]">Reload</button>
        </div>
      </div>
    </div>
  )
}
