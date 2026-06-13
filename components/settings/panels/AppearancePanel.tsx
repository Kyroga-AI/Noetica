'use client'

import { useSettings } from '@/lib/settings/context'
import { useTheme } from '@/contexts/ThemeContext'
import { themes } from '@/config/themes'
import type { SidebarDensity } from '@/lib/settings/types'

export function AppearancePanel() {
  const { settings, update } = useSettings()
  const { themeId, setTheme } = useTheme()

  return (
    <div className="space-y-6">
      {/* Theme */}
      <div>
        <label className="block text-sm font-semibold text-[var(--color-text-primary)]">Theme</label>
        <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">Choose a color theme for the interface.</p>
        <div className="mt-3 flex gap-2">
          {themes.map((t) => {
            const active = themeId === t.id
            return (
              <button
                key={t.id}
                onClick={() => setTheme(t.id)}
                className={`flex flex-col items-start gap-2 rounded-xl border p-3 text-left transition ${
                  active
                    ? 'border-[#1d4ed8] bg-[rgba(29,78,216,0.08)]'
                    : 'border-[var(--color-border-tertiary)] hover:border-[var(--color-border-secondary)]'
                }`}
                style={{ minWidth: 88 }}
              >
                {/* Color swatch */}
                <span
                  className="flex h-7 w-full items-center justify-center overflow-hidden rounded-lg border border-[var(--color-border-tertiary)]"
                  style={{ background: t.preview.bg }}
                >
                  <span
                    className="block h-4 w-4 rounded"
                    style={{ background: t.preview.sidebar }}
                  />
                </span>
                <span className={`text-xs font-semibold ${active ? 'text-[#1d4ed8]' : 'text-[var(--color-text-secondary)]'}`}>
                  {t.label}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Sidebar density */}
      <div>
        <label className="block text-sm font-semibold text-[var(--color-text-primary)]">Sidebar density</label>
        <div className="mt-3 flex gap-2">
          {(['comfortable', 'compact'] as SidebarDensity[]).map((d) => (
            <button
              key={d}
              onClick={() => update({ sidebarDensity: d })}
              className={`rounded-xl border px-4 py-2 text-sm capitalize transition ${
                settings.sidebarDensity === d
                  ? 'border-[#1d4ed8] bg-[rgba(29,78,216,0.08)] font-semibold text-[#1d4ed8]'
                  : 'border-[var(--color-border-tertiary)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-secondary)]'
              }`}
            >
              {d}
            </button>
          ))}
        </div>
      </div>

      {/* Font size */}
      <div>
        <label className="block text-sm font-semibold text-[var(--color-text-primary)]">Font size</label>
        <div className="mt-3 flex gap-2">
          {([['sm', 'Small'], ['md', 'Medium'], ['lg', 'Large']] as const).map(([val, label]) => (
            <button
              key={val}
              onClick={() => update({ fontSize: val })}
              className={`rounded-xl border px-4 py-2 text-sm transition ${
                settings.fontSize === val
                  ? 'border-[#1d4ed8] bg-[rgba(29,78,216,0.08)] font-semibold text-[#1d4ed8]'
                  : 'border-[var(--color-border-tertiary)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-secondary)]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
