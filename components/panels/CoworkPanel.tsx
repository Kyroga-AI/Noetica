export function CoworkPanel() {
  return (
    <aside className="hidden min-h-0 overflow-y-auto border-l border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] p-4 lg:block">
      <div className="space-y-3">
        <section className="rounded-2xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] p-4 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[#1d4ed8]">Participants</div>
          <div className="mt-3 text-sm text-[var(--color-text-tertiary)]">No agents or users assigned yet.</div>
        </section>
        <section className="rounded-2xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] p-4 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[#1d4ed8]">Status</div>
          <div className="mt-3 space-y-2">
            {['Planning', 'In progress', 'Blocked', 'Done'].map((s) => (
              <div key={s} className="flex items-center justify-between text-xs">
                <span className="text-[var(--color-text-secondary)]">{s}</span>
                <span className="font-semibold text-[var(--color-text-primary)]">0</span>
              </div>
            ))}
          </div>
        </section>
        <section className="rounded-2xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] p-4 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[#1d4ed8]">Blockers</div>
          <div className="mt-3 text-sm text-[var(--color-text-tertiary)]">None logged.</div>
        </section>
      </div>
    </aside>
  )
}
