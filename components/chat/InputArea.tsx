'use client'

import { useRef, useState } from 'react'
import type { PendingAttachment } from '@/lib/types/attachment'
import { MAX_ATTACHMENTS } from '@/lib/types/attachment'
import { readFilesAsAttachments, openNativeFilePicker } from '@/lib/attachments/reader'
import { isTauri } from '@/lib/tauri/bridge'
import type { McpTool } from '@/lib/types/mcp'
import { McpToolPicker } from '@/components/mcp/McpToolPicker'
import { models } from '@/config/models'

export type WorkspaceMode = 'Chat' | 'Cowork' | 'Code' | 'Benchmark'

type InputAreaProps = {
  onSend: (content: string, attachments: PendingAttachment[], mcpTools?: string[]) => Promise<void>
  onFanout?: (content: string, attachments: PendingAttachment[]) => Promise<void>
  onStop?: () => void
  disabled?: boolean
  fanoutModelCount?: number
  workspaceMode: WorkspaceMode
  onWorkspaceModeChange: (mode: WorkspaceMode) => void
  mcpTools?: McpTool[]
  modelId?: string
  onModelChange?: (id: string) => void
  thinkingBudget?: number
  onOpenPalette?: () => void
  systemPrompt?: string
  onSystemPromptChange?: (prompt: string) => void
}

const KIND_ICON: Record<string, string> = {
  image: '🖼',
  pdf: '📄',
  text: '📝',
  code: '⌥',
  binary: '📦',
}

function AttachmentChip({ attachment, onRemove }: { attachment: PendingAttachment; onRemove: () => void }) {
  return (
    <div className="flex items-center gap-1.5 rounded-lg border border-[var(--color-border-tertiary)] bg-[var(--color-background-secondary)] px-2 py-1 text-xs">
      <span>{KIND_ICON[attachment.kind] ?? '📎'}</span>
      <span className="max-w-[120px] truncate text-[var(--color-text-primary)]">{attachment.name}</span>
      <span className="text-[var(--color-text-tertiary)]">{attachment.sizeLabel}</span>
      <button
        onClick={onRemove}
        className="ml-0.5 text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]"
        title="Remove"
      >
        <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden>
          <path d="M1 1l6 6M7 1L1 7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
        </svg>
      </button>
    </div>
  )
}

export function InputArea({
  onSend, onFanout, onStop,
  disabled = false,
  fanoutModelCount = 0,
  workspaceMode, onWorkspaceModeChange,
  mcpTools = [],
  modelId, onModelChange, thinkingBudget, onOpenPalette,
  systemPrompt = '', onSystemPromptChange,
}: InputAreaProps) {
  const [content, setContent] = useState('')
  const [sending, setSending] = useState(false)
  const [fanoutActive, setFanoutActive] = useState(false)
  const [attachments, setAttachments] = useState<PendingAttachment[]>([])
  const [attachError, setAttachError] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const [selectedTools, setSelectedTools] = useState<string[]>([])
  const [showModes, setShowModes] = useState(false)
  const [showModelPicker, setShowModelPicker] = useState(false)
  const [showSystemPrompt, setShowSystemPrompt] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const activeModel = models.find((m) => m.id === modelId) ?? models[0]
  // Short display name: "Sonnet 4.6", "GPT-4o", etc — strip "Claude " prefix
  const modelShortName = (activeModel?.label ?? modelId).replace(/^Claude\s+/i, '')
  const thinkingLabel = thinkingBudget == null ? null
    : thinkingBudget === 0 ? null
    : thinkingBudget <= 5000 ? 'Low'
    : thinkingBudget <= 15000 ? 'Medium'
    : 'High'

  function toggleTool(key: string) {
    setSelectedTools((prev) => prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key])
  }

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

  function autoResize(el: HTMLTextAreaElement) {
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }

  async function submit() {
    const trimmed = content.trim()
    if ((!trimmed && attachments.length === 0) || sending || disabled) return
    setSending(true)
    const toSend = [...attachments]
    const toolsToSend = [...selectedTools]
    setContent('')
    setAttachments([])
    setSelectedTools([])
    setAttachError('')
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
    try {
      if (fanoutActive && onFanout) {
        await onFanout(trimmed, toSend)
      } else {
        await onSend(trimmed, toSend, toolsToSend.length > 0 ? toolsToSend : undefined)
      }
    } finally {
      setSending(false)
    }
  }

  const canSend = (content.trim().length > 0 || attachments.length > 0) && !sending && !disabled

  return (
    <div
      className={`px-4 pb-5 pt-2 transition ${dragOver ? 'opacity-80' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={async (e) => {
        e.preventDefault()
        setDragOver(false)
        await addFiles(e.dataTransfer.files)
      }}
    >
      <div className={`mx-auto w-full max-w-3xl rounded-2xl border bg-[var(--color-background-primary)] transition ${
        dragOver ? 'border-[var(--color-border-primary)]' : 'border-[var(--color-border-secondary)]'
      }`}>

        {/* Attachment chips */}
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-3 pt-2.5">
            {attachments.map((a) => (
              <AttachmentChip key={a.clientId} attachment={a} onRemove={() => removeAttachment(a.clientId)} />
            ))}
          </div>
        )}

        {attachError && (
          <div className="mx-3 mt-2 rounded-lg border border-[#fecaca] bg-[#fef2f2] px-2.5 py-1.5 text-xs text-[#dc2626]">
            {attachError}
          </div>
        )}

        {/* Mode badge — only when non-Chat mode is active */}
        {workspaceMode !== 'Chat' && (
          <div className="flex items-center gap-1.5 px-3 pt-2.5">
            <span className="flex items-center gap-1 rounded-md border border-[var(--color-border-tertiary)] bg-[var(--color-background-secondary)] px-2 py-0.5 text-xs font-medium text-[var(--color-text-primary)]">
              {workspaceMode}
              <button onClick={() => onWorkspaceModeChange('Chat')} className="ml-0.5 text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]">
                <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden><path d="M1 1l6 6M7 1L1 7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
              </button>
            </span>
            {fanoutActive && (
              <span className="flex items-center gap-1 rounded-md border border-[var(--color-border-tertiary)] bg-[var(--color-background-secondary)] px-2 py-0.5 text-xs font-medium text-[var(--color-text-primary)]">
                Fan-out ×{fanoutModelCount}
                <button onClick={() => setFanoutActive(false)} className="ml-0.5 text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]">
                  <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden><path d="M1 1l6 6M7 1L1 7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
                </button>
              </span>
            )}
          </div>
        )}

        {/* System prompt panel */}
        {showSystemPrompt && onSystemPromptChange && (
          <div className="border-b border-[var(--color-border-tertiary)] px-3 py-2">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-text-tertiary)]">System prompt</span>
              <button
                onClick={() => { setShowSystemPrompt(false); onSystemPromptChange('') }}
                className="text-[10px] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]"
              >
                clear ×
              </button>
            </div>
            <textarea
              rows={3}
              value={systemPrompt}
              onChange={(e) => onSystemPromptChange(e.target.value)}
              placeholder="You are a helpful assistant…"
              className="w-full resize-none border-0 bg-transparent text-[12px] leading-5 text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-tertiary)]"
            />
          </div>
        )}

        {/* Textarea */}
        <textarea
          ref={textareaRef}
          rows={1}
          className="w-full resize-none border-0 bg-transparent px-3 py-3 text-[13px] leading-6 text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-tertiary)] disabled:opacity-60"
          placeholder={dragOver ? 'Drop files to attach…' : 'Type / for commands'}
          value={content}
          disabled={disabled}
          onChange={(e) => {
            const val = e.target.value
            if (val === '/' && onOpenPalette) { setContent(''); onOpenPalette(); return }
            setContent(val); autoResize(e.target)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void submit()
            if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
              e.preventDefault()
              void submit()
            }
          }}
          onPaste={async (e) => {
            if (e.clipboardData.files.length > 0) {
              e.preventDefault()
              await addFiles(e.clipboardData.files)
            }
          }}
        />

        {/* Bottom toolbar */}
        <div className="flex items-center gap-1 border-t border-[var(--color-border-tertiary)] px-2 py-1.5">
          {/* Attach — plus icon */}
          <button
            type="button"
            onClick={handleAttachClick}
            disabled={disabled || attachments.length >= MAX_ATTACHMENTS}
            title="Attach file"
            style={{ border: 'none', background: 'none', outline: 'none' }}
            className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--color-text-tertiary)] transition hover:bg-[var(--color-background-secondary)] hover:text-[var(--color-text-secondary)] disabled:opacity-40"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path d="M8 2v12M2 8h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>

          {/* MCP tools */}
          <McpToolPicker tools={mcpTools} selected={selectedTools} onToggle={toggleTool} />

          {/* System prompt toggle */}
          {onSystemPromptChange && (
            <button
              type="button"
              onClick={() => setShowSystemPrompt((v) => !v)}
              title="System prompt"
              style={{ border: 'none', background: 'none', outline: 'none' }}
              className={`flex h-7 items-center gap-1 rounded-md px-1.5 text-[11px] transition ${
                systemPrompt
                  ? 'text-[var(--color-text-primary)]'
                  : showSystemPrompt
                  ? 'text-[var(--color-text-secondary)]'
                  : 'text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]'
              }`}
            >
              <svg width="11" height="11" viewBox="0 0 14 14" fill="none" aria-hidden>
                <path d="M2 4h10M2 7h7M2 10h5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
              </svg>
              {systemPrompt ? 'sys' : ''}
            </button>
          )}

          <div className="flex-1" />

          {/* Model picker — tiny muted text at bottom right, like Claude.ai */}
          {modelId && onModelChange && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowModelPicker((v) => !v)}
                className="flex h-7 items-center gap-0.5 border-0 bg-transparent px-1.5 text-[11px] font-normal text-[var(--color-text-tertiary)] outline-none transition hover:text-[var(--color-text-secondary)]"
              >
                {modelShortName}
                {thinkingLabel && (
                  <span className="ml-1 text-[10px] text-[var(--color-text-tertiary)]">{thinkingLabel}</span>
                )}
                <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden>
                  <path d="M1.5 3l2 2 2-2" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
              {showModelPicker && (
                <div className="absolute bottom-10 right-0 z-50 w-52 rounded-xl border border-[var(--color-border-tertiary)] bg-[var(--color-background-primary)] py-1 shadow-lg">
                  {models.map((m) => (
                    <button key={m.id} type="button"
                      onClick={() => { onModelChange(m.id); setShowModelPicker(false) }}
                      className={`flex w-full items-center gap-2 px-3 py-1.5 text-xs transition hover:bg-[var(--color-background-secondary)] ${m.id === modelId ? 'font-medium text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)]'}`}
                    >
                      {m.id === modelId && <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden><circle cx="4" cy="4" r="3" fill="currentColor"/></svg>}
                      {m.id !== modelId && <span className="w-2" />}
                      {m.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Send / Stop */}
          {disabled ? (
            <button
              type="button"
              onClick={onStop}
              style={{ border: 'none', outline: 'none' }}
              className="flex h-7 w-7 items-center justify-center rounded-md bg-[var(--color-background-secondary)] text-[var(--color-text-secondary)] transition hover:text-[#dc2626]"
              title="Stop"
            >
              <svg width="9" height="9" viewBox="0 0 10 10" fill="currentColor" aria-hidden>
                <rect x="1.5" y="1.5" width="7" height="7" rx="1.5"/>
              </svg>
            </button>
          ) : (
            <button
              type="button"
              disabled={!canSend}
              onClick={() => void submit()}
              style={{ border: 'none', outline: 'none' }}
              className="flex h-7 w-7 items-center justify-center rounded-md bg-[var(--color-text-primary)] text-[var(--color-background-primary)] transition disabled:cursor-not-allowed disabled:opacity-30"
              title="Send (Enter)"
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden>
                <path d="M8 13V3M3 8l5-5 5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          )}
        </div>
      </div>

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
