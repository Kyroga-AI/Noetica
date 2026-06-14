export function EvaluatePanel() {
  return (
    <aside className="hidden min-h-0 overflow-y-auto border-l border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] p-4 lg:block">
      <div className="space-y-3">
        <section className="rounded-2xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] p-4 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[#1d4ed8]">Scoring rubric</div>
          <div className="mt-3 space-y-2">
            {['Correctness', 'Latency', 'Cost', 'Safety'].map((dim) => (
              <div key={dim} className="flex items-center justify-between text-xs">
                <span className="text-[var(--color-text-secondary)]">{dim}</span>
                <span className="font-semibold text-[var(--color-text-tertiary)]">—</span>
              </div>
            ))}
          </div>
        </section>
        <section className="rounded-2xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] p-4 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[#1d4ed8]">Last run</div>
          <div className="mt-3 text-sm text-[var(--color-text-tertiary)]">No runs yet.</div>
        </section>
        <section className="rounded-2xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] p-4 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[#1d4ed8]">Model comparison</div>
          <div className="mt-3 text-sm text-[var(--color-text-tertiary)]">Run a benchmark to compare model output.</div>
        </section>
      </div>
    </aside>
  )
}
