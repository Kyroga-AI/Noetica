'use client'

import { useState } from 'react'
import { themes } from '@/config/themes'
import { useTheme } from '@/contexts/ThemeContext'

export function ThemePicker() {
  const { themeId, setTheme } = useTheme()
  const [open, setOpen] = useState(false)

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        style={{ border: 'none', background: 'none' }}
        className="flex h-6 w-6 items-center justify-center rounded-md text-[var(--color-text-tertiary)] transition hover:bg-[var(--color-background-secondary)] hover:text-[var(--color-text-secondary)]"
        aria-label="Theme picker"
        title="Switch theme"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
          <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.4" />
          <path d="M8 2v6l3.5 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          <circle cx="8" cy="8" r="1.5" fill="currentColor" />
        </svg>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className="absolute right-0 top-8 z-50 w-44 overflow-hidden rounded-xl border border-[var(--color-border-secondary)] shadow-xl"
            style={{ background: 'var(--color-background-primary)' }}
          >
            <div className="px-3 pb-1.5 pt-2.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-tertiary)]">
              Theme
            </div>
            {themes.map((t) => {
              const active = themeId === t.id
              return (
                <button
                  key={t.id}
                  onClick={() => { setTheme(t.id); setOpen(false) }}
                  style={{ border: 'none', background: 'none', width: '100%' }}
                  className={`flex w-full items-center gap-2.5 px-3 py-2 text-left transition ${
                    active
                      ? 'bg-[var(--color-background-secondary)]'
                      : 'hover:bg-[var(--color-background-secondary)]'
                  }`}
                >
                  {/* mini swatch */}
                  <span
                    className="flex h-5 w-5 shrink-0 items-center justify-center overflow-hidden rounded-md border border-[var(--color-border-tertiary)]"
                    style={{ background: t.preview.bg }}
                  >
                    <span
                      className="block h-2.5 w-2.5 rounded-sm"
                      style={{ background: t.preview.sidebar }}
                    />
                  </span>
                  <span className="flex flex-col">
                    <span className={`text-[12px] font-medium ${active ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)]'}`}>
                      {t.label}
                    </span>
                    <span className="text-[10px] text-[var(--color-text-tertiary)]">{t.description}</span>
                  </span>
                  {active && (
                    <svg className="ml-auto shrink-0" width="10" height="10" viewBox="0 0 10 10" fill="none">
                      <path d="M2 5l2 2 4-4" stroke="var(--color-text-secondary)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </button>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
