export function CalendarPanel() {
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-[#d7dee8] px-4 py-3">
        <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[#1d4ed8]">Calendar</div>
        <div className="mt-0.5 text-xs text-[#64748b]">{today}</div>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        <div className="text-xs font-semibold text-[#334155]">Today</div>
        <div className="rounded-xl border border-dashed border-[#e2e8f0] bg-[#f8fafc] px-3 py-4 text-center text-xs text-[#94a3b8]">
          No events. Connect Prophet Calendar or Google Calendar in Settings → Connectors.
        </div>
        <button className="w-full rounded-xl border border-[#bfdbfe] bg-white px-3 py-2 text-xs font-medium text-[#1d4ed8] transition hover:bg-[#eff6ff]">
          + Schedule from task
        </button>
      </div>
    </div>
  )
}
