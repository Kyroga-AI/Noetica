export function CalendarPanel() {
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-[var(--color-border-secondary)] px-4 py-3">
        <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[#1d4ed8]">Calendar</div>
        <div className="mt-0.5 text-xs text-[var(--color-text-secondary)]">{today}</div>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        <div className="text-xs font-semibold text-[var(--color-text-secondary)]">Today</div>
        <div className="rounded-xl border border-dashed border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] px-3 py-4 text-center text-xs text-[var(--color-text-tertiary)]">
          No events. Connect Prophet Calendar or Google Calendar in Settings → Connectors.
        </div>
        <button className="w-full rounded-xl border border-[#bfdbfe] bg-[var(--color-background-primary)] px-3 py-2 text-xs font-medium text-[#1d4ed8] transition hover:bg-[#eff6ff]">
          + Schedule from task
        </button>
      </div>
    </div>
  )
}
