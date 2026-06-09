const conversations = [
  'Build readiness pass',
  'SourceOS event bridge',
  'Packaging hardening',
  'Runtime status review'
]

export function Sidebar() {
  return (
    <aside className="hidden w-72 shrink-0 border-r border-[#e7e0d8] bg-[#f4eee5] px-3 py-4 lg:flex lg:flex-col">
      <div className="px-2 pb-4">
        <button className="flex w-full items-center justify-center rounded-xl border border-[#d8ccbd] bg-[#fcfaf7] px-3 py-2.5 text-sm font-medium text-[#2f261d] shadow-sm transition hover:bg-white">
          New chat
        </button>
      </div>

      <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto px-1">
        <div className="px-2 pb-2 text-[11px] font-medium uppercase tracking-[0.16em] text-[#8a8177]">Recent</div>
        {conversations.map((item, index) => (
          <button
            key={item}
            className={`w-full truncate rounded-xl px-3 py-2 text-left text-sm transition ${
              index === 0 ? 'bg-[#e9dfd2] text-[#1f1b16]' : 'text-[#5f564d] hover:bg-[#eee6dc] hover:text-[#1f1b16]'
            }`}
          >
            {item}
          </button>
        ))}
      </nav>

      <div className="mt-4 rounded-2xl border border-[#e1d6c8] bg-[#fcfaf7] p-3 text-xs leading-5 text-[#6f665d]">
        <div className="font-semibold text-[#2f261d]">Noetica</div>
        <p className="mt-1">Session-local workspace. Memory writes remain disabled until governed memory integration lands.</p>
      </div>
    </aside>
  )
}
