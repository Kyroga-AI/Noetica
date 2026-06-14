export function MatrixPanel() {
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-[var(--color-border-secondary)] px-4 py-3">
        <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[#1d4ed8]">Matrix</div>
        <div className="mt-0.5 text-xs text-[var(--color-text-secondary)]">Workspace rooms / ChatOps</div>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        <div className="text-xs font-semibold text-[var(--color-text-secondary)]">Rooms</div>
        {['Workroom', 'Project', 'Agent', 'General'].map((type) => (
          <div key={type} className="flex items-center justify-between rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-3 py-2.5">
            <div>
              <div className="text-xs font-semibold text-[var(--color-text-primary)]">{type} rooms</div>
              <div className="text-[10px] text-[var(--color-text-tertiary)]">0 unread</div>
            </div>
            <span className="text-xs text-[var(--color-text-tertiary)]">—</span>
          </div>
        ))}
        <div className="rounded-xl border border-dashed border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] px-3 py-4 text-center text-xs text-[var(--color-text-tertiary)]">
          Connect Matrix homeserver in Settings → Connectors.
        </div>
      </div>
    </div>
  )
}
