export function ProjectsSurface() {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-6">
      <div className="mx-auto w-full max-w-4xl space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-lg font-semibold text-[#0f172a]">Projects</div>
            <div className="text-xs text-[#64748b]">Active workspaces, workrooms, backlogs, and sprints.</div>
          </div>
          <button className="rounded-xl bg-[#0f172a] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#1e293b]">
            + New project
          </button>
        </div>

        {/* Board view toggle */}
        <div className="flex gap-1 rounded-xl border border-[#e2e8f0] bg-[#f8fafc] p-1 w-fit">
          {['Board', 'Backlog', 'Sprints', 'Workrooms'].map((v) => (
            <button key={v} className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${v === 'Board' ? 'bg-white shadow-sm text-[#0f172a]' : 'text-[#64748b] hover:text-[#0f172a]'}`}>
              {v}
            </button>
          ))}
        </div>

        {/* Status columns */}
        <div className="grid grid-cols-4 gap-3">
          {['Backlog', 'In Progress', 'In Review', 'Done'].map((col) => (
            <div key={col} className="rounded-2xl border border-[#d7dee8] bg-[#f8fafc]">
              <div className="border-b border-[#d7dee8] px-4 py-3">
                <div className="text-xs font-semibold text-[#334155]">{col}</div>
                <div className="text-[10px] text-[#94a3b8]">0 items</div>
              </div>
              <div className="p-3">
                <button className="flex w-full items-center justify-center gap-1 rounded-lg border border-dashed border-[#d7dee8] py-2 text-xs text-[#94a3b8] transition hover:border-[#bfdbfe] hover:text-[#1d4ed8]">
                  + Add item
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* External connectors note */}
        <div className="rounded-2xl border border-[#d7dee8] bg-white p-4">
          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[#94a3b8]">External work connectors</div>
          <div className="mt-2 flex flex-wrap gap-2">
            {['Jira', 'Linear', 'GitHub Issues', 'GitLab Issues', 'Asana'].map((c) => (
              <span key={c} className="rounded-full border border-[#e2e8f0] bg-[#f8fafc] px-3 py-1 text-xs text-[#64748b]">
                {c}
              </span>
            ))}
          </div>
          <div className="mt-2 text-xs text-[#94a3b8]">
            Import/export only. Native work management is the source of truth.
          </div>
        </div>
      </div>
    </div>
  )
}
