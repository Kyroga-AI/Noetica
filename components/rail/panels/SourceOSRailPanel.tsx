export function SourceOSRailPanel() {
  const rows: [string, string, string][] = [
    ['Runtime',       'Standalone', 'text-[#22c55e]'],
    ['Graph',         'Not connected', 'text-[#94a3b8]'],
    ['Event ledger',  'Not connected', 'text-[#94a3b8]'],
    ['Sync queues',   '0 pending', 'text-[#94a3b8]'],
    ['Agent machine', 'Not connected', 'text-[#94a3b8]'],
    ['Policy fabric', 'Not configured', 'text-[#94a3b8]'],
  ]
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-[#d7dee8] px-4 py-3">
        <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[#1d4ed8]">SourceOS</div>
        <div className="mt-0.5 text-xs text-[#64748b]">Native substrate status</div>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {rows.map(([label, value, color]) => (
          <div key={label} className="flex items-center justify-between text-xs">
            <span className="text-[#334155]">{label}</span>
            <span className={`font-semibold ${color}`}>{value}</span>
          </div>
        ))}
        <div className="pt-3 space-y-1.5">
          {['Open graph explorer', 'Open event ledger', 'Replay view', 'Export'].map((action) => (
            <button key={action} className="w-full rounded-xl border border-[#e2e8f0] bg-white px-3 py-2 text-left text-xs text-[#334155] transition hover:bg-[#f8fafc]">
              {action}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
