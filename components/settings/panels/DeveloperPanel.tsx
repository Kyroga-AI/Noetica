'use client'

import { useSettings } from '@/lib/settings/context'
import { isTauri } from '@/lib/tauri/bridge'

export function DeveloperPanel() {
  const { settings, update } = useSettings()

  return (
    <div className="space-y-6">
      <div>
        <label className="block text-sm font-semibold text-[var(--color-text-primary)]">API endpoint override</label>
        <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">Leave blank to use the default route. Set to a local proxy for debugging.</p>
        <input
          type="url"
          value={settings.apiEndpointOverride}
          onChange={(e) => update({ apiEndpointOverride: e.target.value })}
          placeholder="https://api.anthropic.com"
          className="mt-3 w-full rounded-xl border border-[#bfdbfe] bg-[var(--color-background-secondary)] px-3 py-2 text-sm text-[var(--color-text-primary)] outline-none focus:border-[#1d4ed8] focus:bg-[var(--color-background-primary)]"
        />
      </div>

      <div className="flex items-center gap-3">
        <label className="relative inline-flex cursor-pointer items-center">
          <input
            type="checkbox"
            checked={settings.showRawEvents}
            onChange={(e) => update({ showRawEvents: e.target.checked })}
            className="sr-only"
          />
          <span
            className={`flex h-6 w-11 items-center rounded-full transition-colors ${settings.showRawEvents ? 'bg-[#1d4ed8]' : 'bg-[#cbd5e1]'}`}
          >
            <span
              className={`ml-0.5 h-5 w-5 rounded-full bg-[var(--color-background-primary)] shadow transition-transform ${settings.showRawEvents ? 'translate-x-5' : 'translate-x-0'}`}
            />
          </span>
        </label>
        <span className="text-sm text-[var(--color-text-secondary)]">Show raw SSE events in chat</span>
      </div>

      <div className="rounded-2xl border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] p-4">
        <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[#1d4ed8]">Build info</div>
        <div className="mt-3 space-y-1.5 font-mono text-xs text-[var(--color-text-secondary)]">
          <div className="flex justify-between">
            <span>Version</span>
            <span>0.1.0</span>
          </div>
          <div className="flex justify-between">
            <span>Shell</span>
            <span>{isTauri() ? 'Tauri 2' : 'Browser'}</span>
          </div>
          <div className="flex justify-between">
            <span>Phase</span>
            <span>phase-6-live-status-wiring</span>
          </div>
        </div>
      </div>

      <button
        onClick={() => {
          const data = {
            settings,
            timestamp: new Date().toISOString(),
            userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
          }
          const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
          const url = URL.createObjectURL(blob)
          const a = document.createElement('a')
          a.href = url
          a.download = `noetica-diagnostics-${Date.now()}.json`
          a.click()
          URL.revokeObjectURL(url)
        }}
        className="rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-4 py-2 text-sm font-semibold text-[var(--color-text-secondary)] transition hover:bg-[var(--color-background-secondary)]"
      >
        Export diagnostics
      </button>
    </div>
  )
}
