'use client'

import { useRef, useState, useCallback } from 'react'
import type { PendingAttachment } from '@/lib/types/attachment'
import { MAX_ATTACHMENTS } from '@/lib/types/attachment'
import { readFilesAsAttachments, openNativeFilePicker } from '@/lib/attachments/reader'
import { isTauri, amUrl } from '@/lib/tauri/bridge'
import type { McpTool } from '@/lib/types/mcp'
import { McpToolPicker } from '@/components/mcp/McpToolPicker'
import { IngestQueueTable } from '@/components/chat/IngestQueueTable'
import { visibleModels } from '@/config/models'
import { useSettings } from '@/lib/settings/context'

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
  const [ingestedDocs, setIngestedDocs] = useState<Array<{
    filename: string; chunks: number; entities: number; preview: string[]
  }>>([])
  const [selectedTools, setSelectedTools] = useState<string[]>([])
  const [showModes, setShowModes] = useState(false)
  const [showModelPicker, setShowModelPicker] = useState(false)
  const [showModePicker, setShowModePicker] = useState(false)
  const [showSystemPrompt, setShowSystemPrompt] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const { settings, update } = useSettings()
  const modelList = visibleModels(settings.showAllModels)

  const activeModel = modelList.find((m) => m.id === modelId) ?? modelList[0]
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

  const TEXT_TYPES = new Set(['text/plain','text/markdown','text/csv','application/json',
    'application/javascript','text/javascript','text/typescript','text/html','text/css',
    'application/xml','text/xml','application/x-yaml','text/x-python','text/x-java',
    'text/x-c','text/x-c++','text/x-rust','text/x-go','text/x-sh'])
  const TEXT_EXTS = /\.(ts|tsx|js|jsx|py|rs|go|java|c|cpp|h|hpp|cs|rb|php|swift|kt|md|mdx|txt|json|yaml|yml|toml|xml|html|css|sh|bash|zsh|sql|env|gitignore|dockerfile)$/i
  // Documents whose text must be extracted SERVER-SIDE (binary — browser can't read as text).
  const DOC_EXTS = /\.(docx|pdf)$/i
  // Archives + binary docs go through the NON-BLOCKING ingestion queue (unpacked into a collection scope).
  const ARCHIVE_EXTS = /\.zip$/i
  const [queueVersion, setQueueVersion] = useState(0)   // bumped on each enqueue → the IngestQueueTable polls

  // Binary docs (.docx/.pdf) + archives (.zip): enqueue for background ingestion into a collection scope — the
  // user is NOT blocked, and the queue table shows each file landing in the graph (parsed vs pending).
  async function ingestQueued(file: File): Promise<void> {
    const arr = new Uint8Array(await file.arrayBuffer())
    let bin = ''
    for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]!)
    try {
      const res = await fetch(amUrl('/api/ingest/queue'), {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ filename: file.name, mimeType: file.type, dataBase64: btoa(bin) }),
      })
      if (res.ok || res.status === 202) setQueueVersion((v) => v + 1)
      else { const e = await res.json().catch(() => ({})) as { error?: string }; setAttachError(`Couldn't queue ${file.name}: ${e.error ?? res.status}`) }
    } catch (e) { setAttachError(`Couldn't queue ${file.name}: ${e instanceof Error ? e.message : 'failed'}`) }
  }

  async function postIngest(path: string, payload: unknown, filename: string): Promise<boolean> {
    try {
      const res = await fetch(amUrl(path), {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
      })
      if (res.ok) {
        const data = await res.json() as { chunks: number; entities?: number; preview: string[] }
        setIngestedDocs((prev) => [...prev, { filename, chunks: data.chunks, entities: data.entities ?? 0, preview: data.preview }])
        return true
      }
      const err = await res.json().catch(() => ({})) as { error?: string }
      setAttachError(`Couldn't ingest ${filename}: ${err.error ?? res.status}`)
    } catch (e) {
      setAttachError(`Couldn't ingest ${filename}: ${e instanceof Error ? e.message : 'upload failed'}`)
    }
    return false
  }

  async function addFiles(files: FileList | File[]) {
    setAttachError('')
    const fileArr = Array.from(files)
    // ALL ingestible files — text/code, docs, AND archives — go through the NON-BLOCKING queue. This is the fix
    // for the bulk-load hang: the old path ingested text files SYNCHRONOUSLY one-by-one (each embedding + growing
    // the graph), which blocked the sidecar until it went unreachable. The queue enqueues instantly and drains in
    // the background into a collection scope; the table tracks progress.
    const isIngestible = (f: File) => TEXT_TYPES.has(f.type) || TEXT_EXTS.test(f.name) || DOC_EXTS.test(f.name) || ARCHIVE_EXTS.test(f.name)
    const ingestFiles = fileArr.filter(isIngestible)
    const attachFiles = fileArr.filter((f) => !isIngestible(f))
    ingestFiles.forEach((f) => { void ingestQueued(f) })
    if (attachFiles.length > 0) {
      const remaining = MAX_ATTACHMENTS - attachments.length
      if (remaining <= 0) { setAttachError(`Max ${MAX_ATTACHMENTS} attachments`); return }
      const { ok, errors } = await readFilesAsAttachments(attachFiles.slice(0, remaining))
      setAttachments((prev) => [...prev, ...ok])
      if (errors.length > 0) setAttachError(errors.join('; '))
    }
  }

  async function handleAttachClick() {
    // In the Tauri app the webview can't open an HTML <input type=file> (wry has no
    // open-panel delegate), so use the native dialog plugin to get file PATHS, then
    // let the sidecar (full fs access) read + extract them via /api/ingest/path.
    // In a browser, the HTML input works.
    if (isTauri()) {
      try {
        const dlg: any = await import('@tauri-apps/plugin-dialog')
        const selected: string | string[] | null = await dlg.open({
          multiple: true,
          filters: [{ name: 'Documents & code', extensions: ['pdf', 'docx', 'txt', 'md', 'csv', 'json', 'ts', 'js', 'py', 'rs', 'go', 'yaml', 'yml', 'sql'] }],
        })
        const paths = Array.isArray(selected) ? selected : selected ? [selected] : []
        for (const p of paths) await postIngest('/api/ingest/path', { path: p }, p.split('/').pop() ?? p)
      } catch (e) {
        setAttachError(`Couldn't open file picker: ${e instanceof Error ? e.message : String(e)}`)
      }
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
    if ((!trimmed && attachments.length === 0 && ingestedDocs.length === 0) || sending || disabled) return
    setSending(true)
    const toSend = [...attachments]
    const toolsToSend = [...selectedTools]
    const docs = [...ingestedDocs]
    setContent('')
    setAttachments([])
    setSelectedTools([])
    setAttachError('')
    setIngestedDocs([])
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
    // Prepend ingested document context if any docs were loaded
    let finalContent = trimmed
    if (docs.length > 0) {
      const docContext = docs.map((d) =>
        `[Document: ${d.filename} — ${d.chunks} chunks, ${d.entities} entities extracted]\n${d.preview.map((p, i) => `Chunk ${i + 1}: ${p}…`).join('\n')}`,
      ).join('\n\n')
      finalContent = docContext + (trimmed ? `\n\n${trimmed}` : '\n\nI have loaded the above document(s) into memory. What would you like to know?')
    }
    try {
      if (fanoutActive && onFanout) {
        await onFanout(finalContent, toSend)
      } else {
        await onSend(finalContent, toSend, toolsToSend.length > 0 ? toolsToSend : undefined)
      }
    } finally {
      setSending(false)
    }
  }

  const canSend = (content.trim().length > 0 || attachments.length > 0 || ingestedDocs.length > 0) && !sending && !disabled

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

        {/* Live ingestion queue (bulk/zip uploads → collection scope, parsed-vs-pending) */}
        <div className="px-3 pt-2.5 empty:hidden"><IngestQueueTable refreshSignal={queueVersion} /></div>

        {/* Ingested document chips */}
        {ingestedDocs.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-3 pt-2.5">
            {ingestedDocs.map((d, i) => (
              <div key={i} className="flex items-center gap-1.5 rounded-lg border border-[#166534] bg-[#f0fdf4] px-2 py-1 text-xs dark:border-[#166534] dark:bg-[rgba(22,101,52,0.15)]">
                <span className="text-[#16a34a]">
                  <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden>
                    <path d="M2 1h5.5L10 3.5V11H2V1z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
                    <path d="M6 1v3h4" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
                  </svg>
                </span>
                <span className="max-w-[140px] truncate text-[#166534] dark:text-[#4ade80]">{d.filename}</span>
                <span className="text-[#15803d] dark:text-[#4ade80]">{d.chunks}ch · {d.entities}ent</span>
                <button
                  onClick={() => setIngestedDocs((prev) => prev.filter((_, j) => j !== i))}
                  className="ml-0.5 text-[#15803d] hover:text-[#166534]"
                  title="Remove"
                >
                  <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden>
                    <path d="M1 1l6 6M7 1L1 7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}

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

          {/* Agent mode — Auto / Plan / Ask (autonomy level) */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowModePicker((v) => !v)}
              title="Agent mode — how autonomously it acts"
              className={`flex h-7 items-center gap-1 rounded-md border-0 bg-transparent px-1.5 text-[11px] font-medium capitalize outline-none transition ${settings.agentMode === 'plan' ? 'text-[#d97706]' : settings.agentMode === 'ask' ? 'text-[#0891b2]' : 'text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]'}`}
            >
              {settings.agentMode ?? 'auto'}
              <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden><path d="M1.5 3l2 2 2-2" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </button>
            {showModePicker && (
              <div className="absolute bottom-10 right-0 z-50 w-48 rounded-xl border border-[var(--color-border-tertiary)] bg-[var(--color-background-primary)] py-1 shadow-lg">
                {([['auto', 'Acts autonomously'], ['plan', 'Plans only — no actions'], ['ask', 'Confirms before acting']] as const).map(([m, desc]) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => { update({ agentMode: m }); setShowModePicker(false) }}
                    className={`flex w-full flex-col items-start px-3 py-1.5 text-left transition hover:bg-[var(--color-background-secondary)] ${settings.agentMode === m ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)]'}`}
                  >
                    <span className="text-xs font-medium capitalize">{m}{settings.agentMode === m ? ' ✓' : ''}</span>
                    <span className="text-[10px] text-[var(--color-text-tertiary)]">{desc}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Reply length — cycles short → medium → long, tunes how much the model writes */}
          <button
            type="button"
            onClick={() => { const order = ['short', 'medium', 'long'] as const; const cur = settings.replyLength ?? 'medium'; update({ replyLength: order[(order.indexOf(cur) + 1) % 3] }) }}
            title="Reply length — click to cycle short / medium / long"
            className="flex h-7 items-center gap-1 border-0 bg-transparent px-1.5 text-[11px] font-normal capitalize text-[var(--color-text-tertiary)] outline-none transition hover:text-[var(--color-text-secondary)]"
          >
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden><path d="M2 3h8M2 6h6M2 9h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
            {settings.replyLength ?? 'medium'}
          </button>

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
                  {modelList.map((m) => (
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
