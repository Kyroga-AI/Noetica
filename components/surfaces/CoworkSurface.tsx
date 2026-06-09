export function CoworkSurface() {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-6">
      <div className="mx-auto w-full max-w-3xl space-y-4">
        <div className="rounded-2xl border border-[#d7dee8] bg-white p-5 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[#1d4ed8]">Objective</div>
          <div className="mt-2 rounded-xl border border-dashed border-[#bfdbfe] bg-[#f8fafc] px-4 py-3 text-sm text-[#94a3b8]">
            No active objective. Describe a goal to begin.
          </div>
        </div>

        <div className="rounded-2xl border border-[#d7dee8] bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[#1d4ed8]">Tasks</div>
            <button className="rounded-full bg-[#eff6ff] px-3 py-1 text-xs font-medium text-[#1d4ed8] transition hover:bg-[#dbeafe]">
              + Add task
            </button>
          </div>
          <div className="mt-3 rounded-xl border border-dashed border-[#e2e8f0] bg-[#f8fafc] px-4 py-6 text-center text-sm text-[#94a3b8]">
            No tasks yet. Add a task or send a message to generate a work plan.
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="rounded-2xl border border-[#d7dee8] bg-white p-5 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[#1d4ed8]">Agents</div>
            <div className="mt-3 text-sm text-[#94a3b8]">No agents assigned.</div>
          </div>
          <div className="rounded-2xl border border-[#d7dee8] bg-white p-5 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[#1d4ed8]">Decisions</div>
            <div className="mt-3 text-sm text-[#94a3b8]">No decisions logged.</div>
          </div>
        </div>

        <div className="rounded-2xl border border-[#d7dee8] bg-white p-5 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[#1d4ed8]">Artifacts</div>
          <div className="mt-3 rounded-xl border border-dashed border-[#e2e8f0] bg-[#f8fafc] px-4 py-4 text-sm text-[#94a3b8]">
            No artifacts generated. Documents, code patches, and evidence bundles will appear here.
          </div>
        </div>
      </div>
    </div>
  )
}
