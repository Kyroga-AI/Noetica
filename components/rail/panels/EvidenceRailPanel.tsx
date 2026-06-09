export function EvidenceRailPanel() {
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-[#d7dee8] px-4 py-3">
        <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[#1d4ed8]">Evidence</div>
        <div className="mt-0.5 text-xs text-[#64748b]">Request hashes, replay refs, provenance</div>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {[
          { label: 'Request hash',  value: '—' },
          { label: 'Evidence ref',  value: '—' },
          { label: 'Replay ref',    value: '—' },
          { label: 'Policy ref',    value: '—' },
          { label: 'Evidence hash', value: '—' },
        ].map(({ label, value }) => (
          <div key={label}>
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#94a3b8]">{label}</div>
            <div className="mt-1 font-mono text-xs text-[#334155]">{value}</div>
          </div>
        ))}
        <button className="mt-2 w-full rounded-xl border border-[#e2e8f0] bg-white px-3 py-2 text-xs font-medium text-[#334155] transition hover:bg-[#f8fafc]">
          Export evidence bundle
        </button>
      </div>
    </div>
  )
}
