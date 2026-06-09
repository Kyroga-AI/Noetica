export function CodePanel() {
  return (
    <aside className="hidden min-h-0 overflow-y-auto border-l border-[#d7dee8] bg-[#f8fafc] p-4 lg:block">
      <div className="space-y-3">
        <section className="rounded-2xl border border-[#d7dee8] bg-white p-4 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[#1d4ed8]">Changed files</div>
          <div className="mt-3 text-sm text-[#94a3b8]">No changes. Connect a repo to track diffs.</div>
        </section>
        <section className="rounded-2xl border border-[#d7dee8] bg-white p-4 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[#1d4ed8]">Patch queue</div>
          <div className="mt-3 text-sm text-[#94a3b8]">Empty. Generated patches will queue here for review.</div>
        </section>
        <section className="rounded-2xl border border-[#d7dee8] bg-white p-4 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[#1d4ed8]">Approvals</div>
          <div className="mt-3 space-y-2">
            {['Pending', 'Approved', 'Rejected'].map((s) => (
              <div key={s} className="flex items-center justify-between text-xs">
                <span className="text-[#334155]">{s}</span>
                <span className="font-semibold text-[#0f172a]">0</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </aside>
  )
}
