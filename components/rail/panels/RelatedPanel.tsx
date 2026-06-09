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
      <div className="border-b border-[#d7dee8] px-4 py-3">
        <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[#1d4ed8]">Related</div>
        <div className="mt-0.5 text-xs text-[#64748b]">Contextual to current surface</div>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-1.5">
        {categories.map(({ label, count }) => (
          <div key={label} className="flex items-center justify-between rounded-xl border border-[#e2e8f0] bg-[#f8fafc] px-3 py-2.5 text-xs">
            <span className="text-[#334155]">{label}</span>
            <span className="font-semibold text-[#94a3b8]">{count}</span>
          </div>
        ))}
        <div className="pt-2 text-xs text-[#94a3b8] text-center">
          Related items populate from the Sociosphere graph as you work.
        </div>
      </div>
    </div>
  )
}
