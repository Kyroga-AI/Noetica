export function RelatedPanel() {
  const categories = [
    { label: 'Notes',           count: 0 },
    { label: 'Tasks',           count: 0 },
    { label: 'Artifacts',       count: 0 },
    { label: 'Repositories',    count: 0 },
    { label: 'Emails',          count: 0 },
    { label: 'Calendar events', count: 0 },
    { label: 'Graph nodes',     count: 0 },
  ]
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-[var(--color-border-secondary)] px-4 py-3">
        <div className="text-xs font-semibold text-[#1d4ed8]">Related</div>
        <div className="mt-0.5 text-xs text-[var(--color-text-secondary)]">Contextual to current surface</div>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-1.5">
        {categories.map(({ label, count }) => (
          <div key={label} className="flex items-center justify-between rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] px-3 py-2.5 text-xs">
            <span className="text-[var(--color-text-secondary)]">{label}</span>
            <span className="font-semibold text-[var(--color-text-tertiary)]">{count}</span>
          </div>
        ))}
        <div className="pt-2 text-xs text-[var(--color-text-tertiary)] text-center">
          Related items populate from the Sociosphere graph as you work.
        </div>
      </div>
    </div>
  )
}
