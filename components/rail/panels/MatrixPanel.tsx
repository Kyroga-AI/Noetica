export function MatrixPanel() {
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-[#d7dee8] px-4 py-3">
        <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[#1d4ed8]">Matrix</div>
        <div className="mt-0.5 text-xs text-[#64748b]">Workspace rooms / ChatOps</div>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        <div className="text-xs font-semibold text-[#334155]">Rooms</div>
        {['Workroom', 'Project', 'Agent', 'General'].map((type) => (
          <div key={type} className="flex items-center justify-between rounded-xl border border-[#e2e8f0] bg-white px-3 py-2.5">
            <div>
              <div className="text-xs font-semibold text-[#0f172a]">{type} rooms</div>
              <div className="text-[10px] text-[#94a3b8]">0 unread</div>
            </div>
            <span className="text-xs text-[#94a3b8]">—</span>
          </div>
        ))}
        <div className="rounded-xl border border-dashed border-[#e2e8f0] bg-[#f8fafc] px-3 py-4 text-center text-xs text-[#94a3b8]">
          Connect Matrix homeserver in Settings → Connectors.
        </div>
      </div>
    </div>
  )
}
