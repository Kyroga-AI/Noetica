export function GraphRailPanel() {
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-[var(--color-border-secondary)] px-4 py-3">
        <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[#1d4ed8]">Sociosphere Graph</div>
        <div className="mt-0.5 text-xs text-[var(--color-text-secondary)]">Graph health at a glance</div>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        <div className="grid grid-cols-2 gap-2">
          {[
            ['Nodes',   '—'], ['Edges',    '—'],
            ['Pending', '—'], ['Failed',   '—'],
            ['Orphans', '—'], ['Vector',   '—'],
          ].map(([label, val]) => (
            <div key={label} className="rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] p-2.5 text-center">
              <div className="text-base font-bold text-[var(--color-text-primary)]">{val}</div>
              <div className="text-[10px] text-[var(--color-text-secondary)]">{label}</div>
            </div>
          ))}
        </div>
        <div className="rounded-xl border border-dashed border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] px-3 py-4 text-center text-xs text-[var(--color-text-tertiary)]">
          Graph not connected. Configure Sociosphere Graph endpoint in Settings → Runtime.
        </div>
        <button className="w-full rounded-xl border border-[#bfdbfe] bg-[var(--color-background-primary)] px-3 py-2 text-xs font-medium text-[#1d4ed8] transition hover:bg-[#eff6ff]">
          Open graph explorer
        </button>
      </div>
    </div>
  )
}
