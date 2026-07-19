'use client'

import { useRef, useState } from 'react'
import type { McpTool } from '@/lib/types/mcp'

type McpToolPickerProps = {
  tools: McpTool[]
  selected: string[]           // "serverId:toolName" keys
  onToggle: (key: string) => void
}

export function McpToolPicker({ tools, selected, onToggle }: McpToolPickerProps) {
  const [open, setOpen] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)

  if (tools.length === 0) return null

  const activeCount = selected.length

  return (
    <div className="relative">
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="MCP tools"
        className={`flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition ${
          activeCount > 0
            ? 'border-[var(--color-accent)] bg-[var(--color-accent-bg)] text-[var(--color-accent)]'
            : 'border-[var(--color-border-secondary)] text-[var(--color-text-secondary)] hover:border-[#bfdbfe] hover:bg-[#eff6ff] hover:text-[#1d4ed8]'
        }`}
      >
        <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden>
          <path d="M2 7h10M7 2v10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
          <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.4"/>
        </svg>
        Tools
        {activeCount > 0 && (
          <span className="rounded-full bg-[var(--color-accent)] px-1.5 py-0.5 text-[10px] font-bold text-white leading-none">
            {activeCount}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute bottom-full left-0 z-40 mb-2 w-72 rounded-2xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] shadow-xl">
            <div className="border-b border-[var(--color-border-secondary)] px-4 py-2.5">
              <p className="text-xs font-semibold text-[var(--color-text-primary)]">MCP Tools</p>
              <p className="text-[11px] text-[var(--color-text-secondary)]">Selected tools will be available to the model</p>
            </div>
            <div className="max-h-64 overflow-y-auto p-2 space-y-1">
              {tools.map((t) => {
                const key = `${t.serverId}:${t.name}`
                const isOn = selected.includes(key)
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => onToggle(key)}
                    className={`flex w-full items-start gap-3 rounded-xl border px-3 py-2.5 text-left transition ${
                      isOn
                        ? 'border-[#bbf7d0] bg-[var(--color-accent-bg)]'
                        : 'border-transparent bg-[var(--color-background-secondary)] hover:border-[var(--color-border-secondary)] hover:bg-[var(--color-background-primary)]'
                    }`}
                  >
                    <span className={`mt-0.5 h-4 w-4 shrink-0 rounded border-2 transition ${isOn ? 'border-[var(--color-accent)] bg-[var(--color-accent)]' : 'border-[#cbd5e1]'}`}>
                      {isOn && (
                        <svg viewBox="0 0 10 10" fill="none" className="h-full w-full p-0.5" aria-hidden>
                          <path d="M1.5 5l2.5 2.5 4.5-4.5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-[var(--color-text-primary)]">{t.name}</p>
                      <p className="text-[11px] text-[var(--color-text-secondary)]">{t.serverName}</p>
                      {t.description && <p className="mt-0.5 text-[11px] text-[var(--color-text-tertiary)] line-clamp-2">{t.description}</p>}
                    </div>
                  </button>
                )
              })}
            </div>
            {selected.length > 0 && (
              <div className="border-t border-[var(--color-border-secondary)] px-4 py-2">
                <button
                  onClick={() => { selected.forEach((k) => onToggle(k)); setOpen(false) }}
                  className="text-[11px] text-[var(--color-text-tertiary)] transition hover:text-[#dc2626]"
                >
                  Clear all
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
