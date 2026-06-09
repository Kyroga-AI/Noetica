const ARTIFACT_TYPES = [
  { label: 'Documents',        count: 0, icon: '📄' },
  { label: 'Code files',       count: 0, icon: '⌥'  },
  { label: 'Evidence bundles', count: 0, icon: '🛡' },
  { label: 'Benchmark runs',   count: 0, icon: '📊' },
  { label: 'SourceOS events',  count: 0, icon: '⬡'  },
]

export function ArtifactsSurface() {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-6">
      <div className="mx-auto w-full max-w-4xl space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-lg font-semibold text-[#0f172a]">Artifacts</div>
            <div className="text-xs text-[#64748b]">Generated documents, code patches, evidence bundles, and SourceOS interaction events.</div>
          </div>
          <div className="flex gap-2">
            <button className="rounded-xl border border-[#e2e8f0] bg-white px-3 py-2 text-xs font-semibold text-[#334155] transition hover:bg-[#f8fafc]">
              Import
            </button>
            <button className="rounded-xl bg-[#0f172a] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#1e293b]">
              + New artifact
            </button>
          </div>
        </div>

        {/* Type tiles */}
        <div className="grid grid-cols-5 gap-3">
          {ARTIFACT_TYPES.map(({ label, count, icon }) => (
            <button key={label} className="flex flex-col items-center rounded-2xl border border-[#d7dee8] bg-white p-4 text-center transition hover:border-[#bfdbfe] hover:bg-[#eff6ff]">
              <span className="text-2xl">{icon}</span>
              <span className="mt-2 text-xs font-semibold text-[#0f172a]">{label}</span>
              <span className="mt-0.5 text-[10px] text-[#94a3b8]">{count} items</span>
            </button>
          ))}
        </div>

        {/* Recent artifacts */}
        <div className="rounded-2xl border border-[#d7dee8] bg-white p-5 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[#1d4ed8]">Recent</div>
          <div className="mt-4 rounded-xl border border-dashed border-[#e2e8f0] bg-[#f8fafc] px-4 py-10 text-center text-sm text-[#94a3b8]">
            No artifacts yet. Generate content from a chat, code, benchmark, or governance session to create artifacts.
          </div>
        </div>
      </div>
    </div>
  )
}
