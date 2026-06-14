export function SourceOSRailPanel() {
  const rows: [string, string, string][] = [
    ['Runtime',       'Standalone', 'text-[#22c55e]'],
    ['Graph',         'Not connected', 'text-[var(--color-text-tertiary)]'],
    ['Event ledger',  'Not connected', 'text-[var(--color-text-tertiary)]'],
    ['Sync queues',   '0 pending', 'text-[var(--color-text-tertiary)]'],
    ['Agent machine', 'Not connected', 'text-[var(--color-text-tertiary)]'],
    ['Policy fabric', 'Not configured', 'text-[var(--color-text-tertiary)]'],
  ]
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-[var(--color-border-secondary)] px-4 py-3">
        <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[#1d4ed8]">SourceOS</div>
        <div className="mt-0.5 text-xs text-[var(--color-text-secondary)]">Native substrate status</div>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {rows.map(([label, value, color]) => (
          <div key={label} className="flex items-center justify-between text-xs">
            <span className="text-[var(--color-text-secondary)]">{label}</span>
            <span className={`font-semibold ${color}`}>{value}</span>
          </div>
        ))}
        <div className="pt-3 space-y-1.5">
          {['Open graph explorer', 'Open event ledger', 'Replay view', 'Export'].map((action) => (
            <button key={action} className="w-full rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-3 py-2 text-left text-xs text-[var(--color-text-secondary)] transition hover:bg-[var(--color-background-secondary)]">
              {action}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
