'use client'

import { useState } from 'react'

type InputAreaProps = {
  onSend: (content: string) => Promise<void>
  disabled?: boolean
}

export function InputArea({ onSend, disabled = false }: InputAreaProps) {
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
    <div className="border-t border-noetica-line bg-white p-4">
      <div className="rounded-2xl border border-blue-200 bg-white p-3 shadow-shell">
        <textarea
          className="min-h-24 w-full resize-none border-0 bg-transparent text-sm leading-6 text-slate-900 outline-none placeholder:text-slate-400 disabled:opacity-60"
          placeholder="Message the model…"
          value={content}
          disabled={disabled}
          onChange={(event) => setContent(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              void submit()
            }
          }}
        />
        <div className="mt-3 flex items-center justify-between">
          <span className="text-xs text-slate-500">⌘/Ctrl + Enter to send</span>
          <button
            className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
            disabled={sending || disabled || !content.trim()}
            onClick={() => void submit()}
          >
            {sending || disabled ? 'Routing…' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  )
}
