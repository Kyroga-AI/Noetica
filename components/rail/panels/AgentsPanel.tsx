export function AgentsPanel() {
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-[var(--color-border-secondary)] px-4 py-3">
        <div className="text-xs font-semibold text-[#1d4ed8]">Agents</div>
        <div className="mt-0.5 text-xs text-[var(--color-text-secondary)]">Agent Registry — active and dispatched agents</div>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        <div className="grid grid-cols-2 gap-2">
          {[['Active', '0'], ['Queued', '0'], ['Failed', '0'], ['Completed', '0']].map(([label, val]) => (
            <div key={label} className="rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] p-2.5 text-center">
              <div className="text-lg font-bold text-[var(--color-text-primary)]">{val}</div>
              <div className="text-[11px] text-[var(--color-text-secondary)]">{label}</div>
            </div>
          ))}
        </div>
        <div className="rounded-xl border border-dashed border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] px-3 py-4 text-center text-xs text-[var(--color-text-tertiary)]">
          No agents running. Connect Agent Registry via SourceOS Runtime to dispatch agents.
        </div>
        <button disabled title="Connect the Agent Registry first" className="w-full rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-3 py-2 text-xs font-medium text-[var(--color-text-tertiary)] opacity-50 cursor-not-allowed">
          + Dispatch agent
        </button>
      </div>
    </div>
  )
}
