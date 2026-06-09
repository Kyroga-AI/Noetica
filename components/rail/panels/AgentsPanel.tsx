export function AgentsPanel() {
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-[#d7dee8] px-4 py-3">
        <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[#1d4ed8]">Agents</div>
        <div className="mt-0.5 text-xs text-[#64748b]">Agent Registry — active and dispatched agents</div>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        <div className="grid grid-cols-2 gap-2">
          {[['Active', '0'], ['Queued', '0'], ['Failed', '0'], ['Completed', '0']].map(([label, val]) => (
            <div key={label} className="rounded-xl border border-[#e2e8f0] bg-[#f8fafc] p-2.5 text-center">
              <div className="text-lg font-bold text-[#0f172a]">{val}</div>
              <div className="text-[10px] text-[#64748b]">{label}</div>
            </div>
          ))}
        </div>
        <div className="rounded-xl border border-dashed border-[#e2e8f0] bg-[#f8fafc] px-3 py-4 text-center text-xs text-[#94a3b8]">
          No agents running. Connect Agent Registry via SourceOS Runtime to dispatch agents.
        </div>
        <button className="w-full rounded-xl border border-[#bfdbfe] bg-white px-3 py-2 text-xs font-medium text-[#1d4ed8] transition hover:bg-[#eff6ff]">
          + Dispatch agent
        </button>
      </div>
    </div>
  )
}
