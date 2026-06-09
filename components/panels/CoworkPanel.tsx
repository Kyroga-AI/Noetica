export function CoworkPanel() {
  return (
    <aside className="hidden min-h-0 overflow-y-auto border-l border-[#d7dee8] bg-[#f8fafc] p-4 lg:block">
      <div className="space-y-3">
        <section className="rounded-2xl border border-[#d7dee8] bg-white p-4 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[#1d4ed8]">Participants</div>
          <div className="mt-3 text-sm text-[#94a3b8]">No agents or users assigned yet.</div>
        </section>
        <section className="rounded-2xl border border-[#d7dee8] bg-white p-4 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[#1d4ed8]">Status</div>
          <div className="mt-3 space-y-2">
            {['Planning', 'In progress', 'Blocked', 'Done'].map((s) => (
              <div key={s} className="flex items-center justify-between text-xs">
                <span className="text-[#334155]">{s}</span>
                <span className="font-semibold text-[#0f172a]">0</span>
              </div>
            ))}
          </div>
        </section>
        <section className="rounded-2xl border border-[#d7dee8] bg-white p-4 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[#1d4ed8]">Blockers</div>
          <div className="mt-3 text-sm text-[#94a3b8]">None logged.</div>
        </section>
      </div>
    </aside>
  )
}
