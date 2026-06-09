export function MailPanel() {
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-[#d7dee8] px-4 py-3">
        <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[#1d4ed8]">Prophet Mail</div>
        <div className="mt-0.5 text-xs text-[#64748b]">Native workspace mail</div>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        <div className="grid grid-cols-2 gap-2">
          {[['Unread', '0'], ['Flagged', '0'], ['Project-linked', '0'], ['Workroom', '0']].map(([label, val]) => (
            <div key={label} className="rounded-xl border border-[#e2e8f0] bg-[#f8fafc] p-2.5 text-center">
              <div className="text-lg font-bold text-[#0f172a]">{val}</div>
              <div className="text-[10px] text-[#64748b]">{label}</div>
            </div>
          ))}
        </div>
        <div className="rounded-xl border border-dashed border-[#e2e8f0] bg-[#f8fafc] px-3 py-4 text-center text-xs text-[#94a3b8]">
          No mail. Prophet Mail is native — configure endpoint in Settings → Runtime.
        </div>
        <div className="space-y-1.5">
          {['Compose', 'Attach to note', 'Create task from email'].map((action) => (
            <button key={action} className="w-full rounded-xl border border-[#e2e8f0] bg-white px-3 py-2 text-left text-xs text-[#334155] transition hover:bg-[#f8fafc]">
              {action}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
