'use client'

import { useRef, useState } from 'react'
import type { PendingAttachment } from '@/lib/types/attachment'
import { MAX_ATTACHMENTS } from '@/lib/types/attachment'
import { readFilesAsAttachments, openNativeFilePicker } from '@/lib/attachments/reader'
import { isTauri } from '@/lib/tauri/bridge'

export type WorkspaceMode = 'Chat' | 'Cowork' | 'Code' | 'Benchmark'

type InputAreaProps = {
  onSend: (content: string, attachments: PendingAttachment[]) => Promise<void>
  disabled?: boolean
  workspaceMode: WorkspaceMode
  onWorkspaceModeChange: (mode: WorkspaceMode) => void
}

const modes: WorkspaceMode[] = ['Chat', 'Cowork', 'Code', 'Benchmark']

const KIND_ICON: Record<string, string> = {
  image: '🖼',
  pdf:   '📄',
  text:  '📝',
  code:  '⌥',
  binary:'📦',
}

function AttachmentChip({ attachment, onRemove }: { attachment: PendingAttachment; onRemove: () => void }) {
  return (
    <div className="flex items-center gap-1.5 rounded-xl border border-[#bfdbfe] bg-[#eff6ff] px-2.5 py-1.5 text-xs">
      <span>{KIND_ICON[attachment.kind] ?? '📎'}</span>
      <span className="max-w-[120px] truncate font-medium text-[#0f172a]">{attachment.name}</span>
      <span className="text-[#94a3b8]">{attachment.sizeLabel}</span>
      <button
        onClick={onRemove}
        className="ml-0.5 flex h-4 w-4 items-center justify-center rounded-full text-[#94a3b8] transition hover:bg-[#dbeafe] hover:text-[#1d4ed8]"
        title="Remove"
      >
        <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden>
          <path d="M1 1l6 6M7 1L1 7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
        </svg>
      </button>
    </div>
  )
}

export function InputArea({ onSend, disabled = false, workspaceMode, onWorkspaceModeChange }: InputAreaProps) {
  const [content, setContent] = useState('')
  const [sending, setSending] = useState(false)
  const [attachments, setAttachments] = useState<PendingAttachment[]>([])
  const [attachError, setAttachError] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  function removeAttachment(clientId: string) {
    setAttachments((prev) => prev.filter((a) => a.clientId !== clientId))
  }

  async function addFiles(files: FileList | File[]) {
    setAttachError('')
    const remaining = MAX_ATTACHMENTS - attachments.length
    if (remaining <= 0) { setAttachError(`Max ${MAX_ATTACHMENTS} attachments`); return }
    const limited = Array.from(files).slice(0, remaining)
    const { ok, errors } = await readFilesAsAttachments(limited)
    setAttachments((prev) => [...prev, ...ok])
    if (errors.length > 0) setAttachError(errors.join('; '))
  }

  async function handleAttachClick() {
    if (isTauri()) {
      const picked = await openNativeFilePicker()
      const remaining = MAX_ATTACHMENTS - attachments.length
      setAttachments((prev) => [...prev, ...picked.slice(0, remaining)])
    } else {
      fileInputRef.current?.click()
    }
  }

  async function submit() {
    const trimmed = content.trim()
    if ((!trimmed && attachments.length === 0) || sending || disabled) return
    setSending(true)
    const toSend = [...attachments]
    setContent('')
    setAttachments([])
    setAttachError('')
    try {
      await onSend(trimmed, toSend)
    } finally {
      setSending(false)
    }
  }

  return (
    <div
      className={`bg-gradient-to-t from-[#f3f6fa] via-[#f3f6fa] to-transparent px-4 pb-5 pt-3 sm:px-8 transition ${dragOver ? 'opacity-80' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={async (e) => {
        e.preventDefault()
        setDragOver(false)
        await addFiles(e.dataTransfer.files)
      }}
    >
      <div className={`mx-auto w-full max-w-3xl rounded-3xl border bg-white p-3 shadow-[0_18px_50px_rgba(15,23,42,0.10)] transition ${dragOver ? 'border-[#1d4ed8]' : 'border-[#bfdbfe]'}`}>

        {/* Attachment chips */}
        {attachments.length > 0 && (
          <div className="mb-2.5 flex flex-wrap gap-1.5 px-1">
            {attachments.map((a) => (
              <AttachmentChip key={a.clientId} attachment={a} onRemove={() => removeAttachment(a.clientId)} />
            ))}
          </div>
        )}

        {/* Attachment error */}
        {attachError && (
          <div className="mb-2 rounded-xl border border-[#fecaca] bg-[#fef2f2] px-3 py-1.5 text-xs text-[#dc2626]">
            {attachError}
          </div>
        )}

        {/* Text area */}
        <textarea
          className="min-h-24 w-full resize-none border-0 bg-transparent px-1 text-[15px] leading-6 text-[#111827] outline-none placeholder:text-[#94a3b8] disabled:opacity-60"
          placeholder={dragOver ? 'Drop files to attach…' : 'Ask Noetica to reason, cowork, code, or benchmark…'}
          value={content}
          disabled={disabled}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void submit()
          }}
          onPaste={async (e) => {
            if (e.clipboardData.files.length > 0) {
              e.preventDefault()
              await addFiles(e.clipboardData.files)
            }
          }}
        />

        {/* Toolbar */}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[#e2e8f0] pt-3">
          <div className="flex flex-wrap items-center gap-1">
            {/* Attach button */}
            <button
              type="button"
              onClick={handleAttachClick}
              disabled={disabled || attachments.length >= MAX_ATTACHMENTS}
              title="Attach file"
              className="flex h-8 w-8 items-center justify-center rounded-full text-[#64748b] transition hover:bg-[#eff6ff] hover:text-[#1d4ed8] disabled:cursor-not-allowed disabled:opacity-40"
            >
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
                <path d="M13.5 8.5l-5.5 5.5a4 4 0 0 1-5.657-5.657l6.364-6.364a2.5 2.5 0 0 1 3.535 3.535L6.12 11.88a1 1 0 0 1-1.414-1.414L10.5 4.67" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>

            {/* Mode pills */}
            {modes.map((m) => (
              <button
                key={m}
                type="button"
                className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                  m === workspaceMode ? 'bg-[#0f172a] text-white' : 'bg-[#eff6ff] text-[#334155] hover:bg-[#dbeafe]'
                }`}
                onClick={() => onWorkspaceModeChange(m)}
              >
                {m}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            {attachments.length > 0 && (
              <span className="text-xs text-[#64748b]">{attachments.length} file{attachments.length > 1 ? 's' : ''}</span>
            )}
            <span className="hidden text-xs text-[#64748b] sm:inline">⌘/Ctrl + Enter</span>
            <button
              type="button"
              className="rounded-full bg-[#1d4ed8] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1e40af] disabled:cursor-not-allowed disabled:opacity-50"
              disabled={sending || disabled || (!content.trim() && attachments.length === 0)}
              onClick={() => void submit()}
            >
              {sending || disabled ? 'Routing…' : 'Send'}
            </button>
          </div>
        </div>
      </div>

      {/* Hidden browser file input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={async (e) => {
          if (e.target.files) await addFiles(e.target.files)
          e.target.value = ''
        }}
      />
    </div>
  )
}
