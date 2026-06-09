export function GovernPanel() {
  return (
    <aside className="hidden min-h-0 overflow-y-auto border-l border-[#d7dee8] bg-[#f8fafc] p-4 lg:block">
      <div className="space-y-3">
        <section className="rounded-2xl border border-[#d7dee8] bg-white p-4 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[#1d4ed8]">Policy admission</div>
          <div className="mt-3 text-sm text-[#94a3b8]">No active trace. Run a chat to generate a policy decision record.</div>
        </section>
        <section className="rounded-2xl border border-[#d7dee8] bg-white p-4 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[#1d4ed8]">Evidence hash</div>
          <div className="mt-3 font-mono text-xs text-[#94a3b8]">—</div>
        </section>
        <section className="rounded-2xl border border-[#d7dee8] bg-white p-4 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[#1d4ed8]">Replay ref</div>
          <div className="mt-3 font-mono text-xs text-[#94a3b8]">—</div>
        </section>
        <section className="rounded-2xl border border-[#d7dee8] bg-white p-4 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[#1d4ed8]">Grants</div>
          <div className="mt-3 text-sm text-[#94a3b8]">None.</div>
        </section>
      </div>
    </aside>
  )
}
