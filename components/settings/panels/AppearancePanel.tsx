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
      {/* Your name */}
      <div>
        <label className="block text-sm font-semibold text-[var(--color-text-primary)]">Your name</label>
        <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">How Noetica greets you (e.g. on the home screen and in the sidebar).</p>
        <input
          type="text"
          value={settings.userName}
          onChange={(e) => update({ userName: e.target.value })}
          placeholder="Your name"
          className="mt-3 w-full max-w-xs rounded-lg border border-[var(--color-border-tertiary)] bg-[var(--color-background-secondary)] px-3 py-2 text-sm text-[var(--color-text-primary)] outline-none focus:border-[var(--color-border-secondary)]"
        />
      </div>

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
                    ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
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
                <span className={`text-xs font-semibold ${active ? 'text-[var(--accent)]' : 'text-[var(--color-text-secondary)]'}`}>
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
                  ? 'border-[var(--accent)] bg-[var(--accent-soft)] font-semibold text-[var(--accent)]'
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
                  ? 'border-[var(--accent)] bg-[var(--accent-soft)] font-semibold text-[var(--accent)]'
                  : 'border-[var(--color-border-tertiary)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-secondary)]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Typing speed — uniform reveal cadence for every assistant reply (model + local dialogue) */}
      <div>
        <label className="block text-sm font-semibold text-[var(--color-text-primary)]">Typing speed</label>
        <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">
          How fast replies are revealed, in tokens per second. Applies to every response — streamed and instant.
        </p>
        <div className="mt-3 flex gap-2">
          {([[0, 'Instant'], [10, 'Calm · 10/s'], [11, 'Steady · 11/s'], [12, 'Brisk · 12/s']] as const).map(([val, label]) => (
            <button
              key={val}
              onClick={() => update({ typingTokensPerSec: val })}
              className={`rounded-xl border px-4 py-2 text-sm transition ${
                (settings.typingTokensPerSec ?? 11) === val
                  ? 'border-[var(--accent)] bg-[var(--accent-soft)] font-semibold text-[var(--accent)]'
                  : 'border-[var(--color-border-tertiary)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-secondary)]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* TTS voice */}
      <div>
        <label className="block text-sm font-semibold text-[var(--color-text-primary)]">Voice</label>
        <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">
          Spoken responses use OpenAI TTS when an API key is set (Settings → Models). Nova and Shimmer sound the most natural.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {(['nova', 'shimmer', 'alloy', 'echo', 'fable', 'onyx'] as const).map((v) => (
            <button
              key={v}
              onClick={() => update({ ttsVoice: v })}
              className={`rounded-xl border px-4 py-2 text-sm capitalize transition ${
                (settings.ttsVoice ?? 'nova') === v
                  ? 'border-[var(--accent)] bg-[var(--accent-soft)] font-semibold text-[var(--accent)]'
                  : 'border-[var(--color-border-tertiary)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-secondary)]'
              }`}
            >
              {v}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
