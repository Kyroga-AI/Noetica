const conversations = [
  'Build readiness pass',
  'SourceOS event bridge',
  'Packaging hardening',
  'Runtime status review'
]

export function Sidebar() {
  return (
    <aside className="hidden w-72 shrink-0 border-r border-[#d7dee8] bg-[#eaf1f8] px-3 py-4 lg:flex lg:flex-col">
      <div className="px-2 pb-4">
        <button className="flex w-full items-center justify-center rounded-xl border border-[#bfdbfe] bg-white px-3 py-2.5 text-sm font-medium text-[#0f172a] shadow-sm transition hover:bg-[#f8fafc]">
          New chat
        </button>
      </div>

      <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto px-1">
        <div className="px-2 pb-2 text-[11px] font-medium uppercase tracking-[0.16em] text-[#64748b]">Recent</div>
        {conversations.map((item, index) => (
          <button
            key={item}
            className={`w-full truncate rounded-xl px-3 py-2 text-left text-sm transition ${
              index === 0 ? 'bg-[#dbeafe] text-[#0f172a]' : 'text-[#475569] hover:bg-[#f8fafc] hover:text-[#0f172a]'
            }`}
          >
            {item}
          </button>
        ))}
      </nav>

      <div className="mt-4 rounded-2xl border border-[#d7dee8] bg-white p-3 text-xs leading-5 text-[#64748b]">
        <div className="font-semibold text-[#0f172a]">Noetica</div>
        <p className="mt-1">Session-local workspace. Memory writes remain disabled until governed memory integration lands.</p>
      </div>
    </aside>
  )
}
