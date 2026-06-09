export function GovernSurface() {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-6">
      <div className="mx-auto w-full max-w-3xl space-y-4">
        {/* Policy profile */}
        <div className="rounded-2xl border border-[#d7dee8] bg-white p-5 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[#1d4ed8]">Policy profile</div>
          <div className="mt-3 flex items-center gap-3">
            <select className="flex-1 rounded-xl border border-[#bfdbfe] bg-[#f8fafc] px-3 py-2 text-sm text-[#334155] outline-none">
              <option>Default policy</option>
              <option>Strict — legal-grade evidence</option>
              <option>Permissive — research mode</option>
            </select>
            <select className="rounded-xl border border-[#bfdbfe] bg-[#f8fafc] px-3 py-2 text-sm text-[#334155] outline-none">
              <option>Evidence level: Standard</option>
              <option>Evidence level: Full hash</option>
              <option>Evidence level: Minimal</option>
            </select>
          </div>
        </div>

        {/* Memory scope */}
        <div className="rounded-2xl border border-[#d7dee8] bg-white p-5 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[#1d4ed8]">Memory scope</div>
          <div className="mt-3 grid grid-cols-3 gap-2">
            {['Session', 'Project', 'Global'].map((scope) => (
              <div key={scope} className="rounded-xl border border-[#e2e8f0] bg-[#f8fafc] p-3 text-center">
                <div className="text-sm font-semibold text-[#0f172a]">{scope}</div>
                <div className="mt-1 text-xs text-[#94a3b8]">0 entries</div>
              </div>
            ))}
          </div>
        </div>

        {/* Audit trail */}
        <div className="rounded-2xl border border-[#d7dee8] bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[#1d4ed8]">Audit trail</div>
            <button className="rounded-full bg-[#eff6ff] px-3 py-1 text-xs font-medium text-[#1d4ed8] transition hover:bg-[#dbeafe]">
              Export
            </button>
          </div>
          <div className="mt-4 rounded-xl border border-dashed border-[#e2e8f0] bg-[#f8fafc] px-4 py-10 text-center text-sm text-[#94a3b8]">
            No governance traces yet. Run a chat to generate request hashes, evidence refs, and policy admission records.
          </div>
        </div>

        {/* Evidence bundles */}
        <div className="rounded-2xl border border-[#d7dee8] bg-white p-5 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[#1d4ed8]">Evidence bundles</div>
          <div className="mt-3 text-sm text-[#94a3b8]">
            Replay refs, provenance hashes, and SourceOS interaction events will appear here.
          </div>
        </div>
      </div>
    </div>
  )
}
