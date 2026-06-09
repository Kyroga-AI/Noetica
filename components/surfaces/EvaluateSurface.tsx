const modelFamilies = ['Claude 3.x', 'GPT-4o', 'Gemini 1.5', 'Llama 3.x', 'Mistral']
const taskFamilies = ['Reasoning', 'Code generation', 'Summarization', 'Tool use', 'Safety / refusal']

export function EvaluateSurface() {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-6">
      <div className="mx-auto w-full max-w-4xl space-y-4">
        {/* Config row */}
        <div className="grid grid-cols-2 gap-4">
          <div className="rounded-2xl border border-[#d7dee8] bg-white p-5 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[#1d4ed8]">Model families</div>
            <div className="mt-3 flex flex-wrap gap-2">
              {modelFamilies.map((f) => (
                <span
                  key={f}
                  className="rounded-full border border-[#e2e8f0] bg-[#f8fafc] px-3 py-1 text-xs text-[#64748b]"
                >
                  {f}
                </span>
              ))}
            </div>
            <button className="mt-3 rounded-full bg-[#eff6ff] px-3 py-1 text-xs font-medium text-[#1d4ed8] transition hover:bg-[#dbeafe]">
              + Add model
            </button>
          </div>
          <div className="rounded-2xl border border-[#d7dee8] bg-white p-5 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[#1d4ed8]">Task families</div>
            <div className="mt-3 flex flex-wrap gap-2">
              {taskFamilies.map((f) => (
                <span
                  key={f}
                  className="rounded-full border border-[#e2e8f0] bg-[#f8fafc] px-3 py-1 text-xs text-[#64748b]"
                >
                  {f}
                </span>
              ))}
            </div>
            <button className="mt-3 rounded-full bg-[#eff6ff] px-3 py-1 text-xs font-medium text-[#1d4ed8] transition hover:bg-[#dbeafe]">
              + Add task
            </button>
          </div>
        </div>

        {/* Run matrix */}
        <div className="rounded-2xl border border-[#d7dee8] bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[#1d4ed8]">Run matrix</div>
            <button className="rounded-full bg-[#0f172a] px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-[#1e293b]">
              Run benchmark
            </button>
          </div>
          <div className="mt-4 rounded-xl border border-dashed border-[#e2e8f0] bg-[#f8fafc] px-4 py-10 text-center text-sm text-[#94a3b8]">
            No runs yet. Configure model and task families above, then run a benchmark.
          </div>
        </div>

        {/* Outcome trace placeholder */}
        <div className="rounded-2xl border border-[#d7dee8] bg-white p-5 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[#1d4ed8]">Outcome traces</div>
          <div className="mt-3 text-sm text-[#94a3b8]">Latency, cost, output quality, and scoring results will appear here after a run.</div>
        </div>
      </div>
    </div>
  )
}
