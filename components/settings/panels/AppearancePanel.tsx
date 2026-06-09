'use client'

import { useSettings } from '@/lib/settings/context'
import type { Theme, SidebarDensity } from '@/lib/settings/types'

export function AppearancePanel() {
  const { settings, update } = useSettings()

  return (
    <div className="space-y-6">
      <div>
        <label className="block text-sm font-semibold text-[#0f172a]">Theme</label>
        <p className="mt-0.5 text-xs text-[#64748b]">Full dark mode requires a style pass — currently sets the preference for when that lands.</p>
        <div className="mt-3 flex gap-2">
          {(['light', 'dark', 'system'] as Theme[]).map((t) => (
            <button
              key={t}
              onClick={() => update({ theme: t })}
              className={`rounded-xl border px-4 py-2 text-sm capitalize transition ${
                settings.theme === t
                  ? 'border-[#1d4ed8] bg-[#eff6ff] font-semibold text-[#1d4ed8]'
                  : 'border-[#e2e8f0] bg-white text-[#334155] hover:bg-[#f8fafc]'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-sm font-semibold text-[#0f172a]">Sidebar density</label>
        <div className="mt-3 flex gap-2">
          {(['comfortable', 'compact'] as SidebarDensity[]).map((d) => (
            <button
              key={d}
              onClick={() => update({ sidebarDensity: d })}
              className={`rounded-xl border px-4 py-2 text-sm capitalize transition ${
                settings.sidebarDensity === d
                  ? 'border-[#1d4ed8] bg-[#eff6ff] font-semibold text-[#1d4ed8]'
                  : 'border-[#e2e8f0] bg-white text-[#334155] hover:bg-[#f8fafc]'
              }`}
            >
              {d}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-sm font-semibold text-[#0f172a]">Font size</label>
        <div className="mt-3 flex gap-2">
          {([['sm', 'Small'], ['md', 'Medium'], ['lg', 'Large']] as const).map(([val, label]) => (
            <button
              key={val}
              onClick={() => update({ fontSize: val })}
              className={`rounded-xl border px-4 py-2 text-sm transition ${
                settings.fontSize === val
                  ? 'border-[#1d4ed8] bg-[#eff6ff] font-semibold text-[#1d4ed8]'
                  : 'border-[#e2e8f0] bg-white text-[#334155] hover:bg-[#f8fafc]'
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
