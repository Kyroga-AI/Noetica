export function EvaluatePanel() {
  return (
    <aside className="hidden min-h-0 overflow-y-auto border-l border-[#d7dee8] bg-[#f8fafc] p-4 lg:block">
      <div className="space-y-3">
        <section className="rounded-2xl border border-[#d7dee8] bg-white p-4 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[#1d4ed8]">Scoring rubric</div>
          <div className="mt-3 space-y-2">
            {['Correctness', 'Latency', 'Cost', 'Safety'].map((dim) => (
              <div key={dim} className="flex items-center justify-between text-xs">
                <span className="text-[#334155]">{dim}</span>
                <span className="font-semibold text-[#94a3b8]">—</span>
              </div>
            ))}
          </div>
        </section>
        <section className="rounded-2xl border border-[#d7dee8] bg-white p-4 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[#1d4ed8]">Last run</div>
          <div className="mt-3 text-sm text-[#94a3b8]">No runs yet.</div>
        </section>
        <section className="rounded-2xl border border-[#d7dee8] bg-white p-4 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[#1d4ed8]">Model comparison</div>
          <div className="mt-3 text-sm text-[#94a3b8]">Run a benchmark to compare model output.</div>
        </section>
      </div>
    </aside>
  )
}
