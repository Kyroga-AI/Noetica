'use client'

import { useSettings } from '@/lib/settings/context'
import type { MemoryScope } from '@/lib/settings/types'

const scopes: { value: MemoryScope; label: string; desc: string }[] = [
  { value: 'disabled', label: 'Disabled', desc: 'No memory written or read.' },
  { value: 'session', label: 'Session', desc: 'Memory lasts until the window closes.' },
  { value: 'project', label: 'Project', desc: 'Memory persists within the active workspace.' },
  { value: 'global', label: 'Global', desc: 'Memory persists across all workspaces.' },
]

export function MemoryPanel() {
  const { settings, update } = useSettings()

  return (
    <div className="space-y-6">
      <div>
        <div className="text-sm font-semibold text-[var(--color-text-primary)]">Memory scope</div>
        <div className="mt-3 space-y-2">
          {scopes.map(({ value, label, desc }) => (
            <button
              key={value}
              onClick={() => update({ memoryScope: value })}
              className={`flex w-full items-start gap-3 rounded-xl border p-3 text-left transition ${
                settings.memoryScope === value
                  ? 'border-[#1d4ed8] bg-[#eff6ff]'
                  : 'border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] hover:bg-[var(--color-background-secondary)]'
              }`}
            >
              <span
                className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 ${
                  settings.memoryScope === value ? 'border-[#1d4ed8] bg-[#1d4ed8]' : 'border-[#cbd5e1]'
                }`}
              >
                {settings.memoryScope === value && (
                  <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-background-primary)]" />
                )}
              </span>
              <div>
                <div className={`text-sm font-semibold ${settings.memoryScope === value ? 'text-[#1d4ed8]' : 'text-[var(--color-text-primary)]'}`}>
                  {label}
                </div>
                <div className="text-xs text-[var(--color-text-secondary)]">{desc}</div>
              </div>
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-sm font-semibold text-[var(--color-text-primary)]">
          Retention — {settings.memoryRetentionDays} days
        </label>
        <input
          type="range"
          min={1}
          max={365}
          value={settings.memoryRetentionDays}
          onChange={(e) => update({ memoryRetentionDays: Number(e.target.value) })}
          className="mt-3 w-full accent-[#1d4ed8]"
          disabled={settings.memoryScope === 'disabled'}
        />
        <div className="mt-1 flex justify-between text-xs text-[var(--color-text-tertiary)]">
          <span>1 day</span>
          <span>1 year</span>
        </div>
      </div>

      <button
        onClick={() => {
          if (typeof window !== 'undefined') {
            const keys = Object.keys(window.localStorage).filter((k) => k.startsWith('noetica:memory'))
            keys.forEach((k) => window.localStorage.removeItem(k))
          }
        }}
        className="rounded-xl border border-[#fecaca] bg-[var(--color-background-primary)] px-4 py-2 text-sm font-semibold text-[#dc2626] transition hover:bg-[#fef2f2]"
      >
        Clear all memory
      </button>
    </div>
  )
}
