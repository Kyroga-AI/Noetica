'use client'

import { useState } from 'react'

export type WorkspaceMode = 'Chat' | 'Cowork' | 'Code' | 'Benchmark'

type InputAreaProps = {
  onSend: (content: string) => Promise<void>
  disabled?: boolean
  workspaceMode: WorkspaceMode
  onWorkspaceModeChange: (mode: WorkspaceMode) => void
}

const modes: WorkspaceMode[] = ['Chat', 'Cowork', 'Code', 'Benchmark']

export function InputArea({ onSend, disabled = false, workspaceMode, onWorkspaceModeChange }: InputAreaProps) {
  const [content, setContent] = useState('')
  const [sending, setSending] = useState(false)

  async function submit() {
    const trimmed = content.trim()
    if (!trimmed || sending || disabled) return

    setSending(true)
    setContent('')

    try {
      await onSend(trimmed)
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="bg-gradient-to-t from-[#f3f6fa] via-[#f3f6fa] to-transparent px-4 pb-5 pt-3 sm:px-8">
      <div className="mx-auto w-full max-w-3xl rounded-3xl border border-[#bfdbfe] bg-white p-3 shadow-[0_18px_50px_rgba(15,23,42,0.10)]">
        <textarea
          className="min-h-24 w-full resize-none border-0 bg-transparent px-1 text-[15px] leading-6 text-[#111827] outline-none placeholder:text-[#94a3b8] disabled:opacity-60"
          placeholder="Ask Noetica to reason, cowork, code, or benchmark…"
          value={content}
          disabled={disabled}
          onChange={(event) => setContent(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              void submit()
            }
          }}
        />
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[#e2e8f0] pt-3">
          <div className="flex flex-wrap items-center gap-1">
            {modes.map((candidate) => (
              <button
                key={candidate}
                className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                  candidate === workspaceMode ? 'bg-[#0f172a] text-white' : 'bg-[#eff6ff] text-[#334155] hover:bg-[#dbeafe]'
                }`}
                onClick={() => onWorkspaceModeChange(candidate)}
                type="button"
              >
                {candidate}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden text-xs text-[#64748b] sm:inline">⌘/Ctrl + Enter</span>
            <button
              className="rounded-full bg-[#1d4ed8] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1e40af] disabled:cursor-not-allowed disabled:opacity-50"
              disabled={sending || disabled || !content.trim()}
              onClick={() => void submit()}
            >
              {sending || disabled ? 'Routing…' : 'Send'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
