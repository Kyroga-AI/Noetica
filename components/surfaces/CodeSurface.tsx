export function CodeSurface() {
  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      {/* File tree */}
      <aside className="flex w-56 shrink-0 flex-col border-r border-[#d7dee8] bg-[#f8fafc] p-3">
        <div className="flex items-center justify-between px-1 pb-2">
          <span className="text-xs font-semibold uppercase tracking-[0.16em] text-[#1d4ed8]">Repository</span>
          <button className="rounded-md px-2 py-1 text-xs text-[#64748b] transition hover:bg-[#e2e8f0]">Connect</button>
        </div>
        <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-[#d7dee8] text-xs text-[#94a3b8]">
          No repo connected
        </div>
      </aside>

      {/* Diff / file viewer */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-[#d7dee8] bg-white px-4 py-2.5">
          <span className="text-xs font-semibold text-[#0f172a]">No file open</span>
          <span className="ml-auto rounded-full bg-[#f1f5f9] px-2 py-0.5 text-xs text-[#64748b]">main</span>
        </div>
        <div className="flex flex-1 items-center justify-center bg-[#f8fafc] text-sm text-[#94a3b8]">
          <div className="space-y-2 text-center">
            <div className="text-2xl">⌥</div>
            <div>Connect a repository to browse files, review diffs, and queue patches.</div>
          </div>
        </div>

        {/* Command log strip */}
        <div className="border-t border-[#d7dee8] bg-[#0f172a] px-4 py-2">
          <div className="text-xs text-[#64748b]">
            <span className="text-[#22c55e]">▶</span> No commands run
          </div>
        </div>
      </div>
    </div>
  )
}
