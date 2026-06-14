export function GovernPanel() {
  return (
    <aside className="hidden min-h-0 overflow-y-auto border-l border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] p-4 lg:block">
      <div className="space-y-3">
        <section className="rounded-2xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] p-4 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[#1d4ed8]">Policy admission</div>
          <div className="mt-3 text-sm text-[var(--color-text-tertiary)]">No active trace. Run a chat to generate a policy decision record.</div>
        </section>
        <section className="rounded-2xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] p-4 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[#1d4ed8]">Evidence hash</div>
          <div className="mt-3 font-mono text-xs text-[var(--color-text-tertiary)]">—</div>
        </section>
        <section className="rounded-2xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] p-4 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[#1d4ed8]">Replay ref</div>
          <div className="mt-3 font-mono text-xs text-[var(--color-text-tertiary)]">—</div>
        </section>
        <section className="rounded-2xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] p-4 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[#1d4ed8]">Grants</div>
          <div className="mt-3 text-sm text-[var(--color-text-tertiary)]">None.</div>
        </section>
      </div>
    </aside>
  )
}
