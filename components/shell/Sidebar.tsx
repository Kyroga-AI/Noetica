const workspaceSections = [
  {
    label: 'Chat',
    active: true,
    items: ['New conversation', 'Build readiness pass', 'Runtime status review']
  },
  {
    label: 'Cowork',
    active: false,
    items: ['Shared task room', 'Decision review', 'Artifact planning']
  },
  {
    label: 'Code',
    active: false,
    items: ['Repo navigator', 'Patch queue', 'Build logs']
  },
  {
    label: 'Evaluate',
    active: false,
    items: ['Task benchmarks', 'Model families', 'Outcome traces']
  },
  {
    label: 'Govern',
    active: false,
    items: ['Policy trace', 'Memory scope', 'Evidence export']
  }
]

export function Sidebar() {
  return (
    <aside className="hidden w-72 shrink-0 border-r border-[#d7dee8] bg-[#eaf1f8] px-3 py-4 lg:flex lg:flex-col">
      <div className="px-2 pb-4">
        <button className="flex w-full items-center justify-center rounded-xl border border-[#bfdbfe] bg-white px-3 py-2.5 text-sm font-semibold text-[#0f172a] shadow-sm transition hover:bg-[#f8fafc]">
          New workspace
        </button>
      </div>

      <nav className="min-h-0 flex-1 space-y-4 overflow-y-auto px-1">
        {workspaceSections.map((section) => (
          <div key={section.label}>
            <button
              className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm font-semibold transition ${
                section.active ? 'bg-[#dbeafe] text-[#0f172a]' : 'text-[#334155] hover:bg-white hover:text-[#0f172a]'
              }`}
            >
              <span>{section.label}</span>
              <span className="text-xs text-[#64748b]">›</span>
            </button>
            <div className="mt-1 space-y-1 pl-3">
              {section.items.map((item) => (
                <button
                  key={item}
                  className="w-full truncate rounded-lg px-3 py-1.5 text-left text-xs text-[#64748b] transition hover:bg-white hover:text-[#0f172a]"
                >
                  {item}
                </button>
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className="mt-4 rounded-2xl border border-[#d7dee8] bg-white p-3 text-xs leading-5 text-[#64748b]">
        <div className="font-semibold text-[#0f172a]">Noetica</div>
        <p className="mt-1">Session-local now. Steering, benchmarking, governance traces, and model-family outcomes become the differentiating workbench.</p>
      </div>
    </aside>
  )
}
