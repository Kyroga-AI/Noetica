export function CodePanel() {
  return (
    <aside className="hidden min-h-0 overflow-y-auto border-l border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] p-4 lg:block">
      <div className="space-y-3">
        <section className="rounded-2xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] p-4 shadow-sm">
          <div className="text-xs font-semibold text-[#1d4ed8]">Changed files</div>
          <div className="mt-3 text-sm text-[var(--color-text-tertiary)]">No changes. Connect a repo to track diffs.</div>
        </section>
        <section className="rounded-2xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] p-4 shadow-sm">
          <div className="text-xs font-semibold text-[#1d4ed8]">Patch queue</div>
          <div className="mt-3 text-sm text-[var(--color-text-tertiary)]">Empty. Generated patches will queue here for review.</div>
        </section>
        <section className="rounded-2xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] p-4 shadow-sm">
          <div className="text-xs font-semibold text-[#1d4ed8]">Approvals</div>
          <div className="mt-3 space-y-2">
            {['Pending', 'Approved', 'Rejected'].map((s) => (
              <div key={s} className="flex items-center justify-between text-xs">
                <span className="text-[var(--color-text-secondary)]">{s}</span>
                <span className="font-semibold text-[var(--color-text-primary)]">0</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </aside>
  )
}
