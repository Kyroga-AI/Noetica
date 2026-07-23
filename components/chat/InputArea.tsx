'use client'

import { useRef, useState, useCallback, useEffect } from 'react'
import type { PendingAttachment } from '@/lib/types/attachment'
import { MAX_ATTACHMENTS } from '@/lib/types/attachment'
import { readFilesAsAttachments, openNativeFilePicker } from '@/lib/attachments/reader'
import { isTauri, amUrl } from '@/lib/tauri/bridge'
import type { McpTool } from '@/lib/types/mcp'
import { McpToolPicker } from '@/components/mcp/McpToolPicker'
import { IngestQueueTable } from '@/components/chat/IngestQueueTable'
import { AudioOverviewPlayer } from '@/components/chat/AudioOverviewPlayer'
import { visibleModels, providersWithKeys } from '@/config/models'
import { useSettings } from '@/lib/settings/context'
import type { RetrievalScope } from '@/lib/projects/types'
import { detectSecrets, redactSecrets } from '@/lib/security/secretPatterns'

export type WorkspaceMode = 'Chat' | 'Collaborate' | 'Code' | 'Benchmark'

export type SendScope = { retrievalScope: RetrievalScope; web: boolean }

type InputAreaProps = {
  onSend: (content: string, attachments: PendingAttachment[], mcpTools?: string[], scope?: SendScope) => Promise<void>
  // Projects context (single source of truth = AppShell). Uploads bind to the project's KB collection, or to
  // this chat's collection when scope='chat'; the scope selector labels the active project.
  activeProjectTitle?: string
  projectCollection?: string
  chatCollection?: string
  // All projects + the active one, so the scope picker can list them and switch
  // the conversation's project inline (single source of truth = AppShell/useProjects).
  projects?: Array<{ id: string; title: string }>
  activeProjectId?: string | null
  onSelectProject?: (id: string) => void
  onFanout?: (content: string, attachments: PendingAttachment[]) => Promise<void>
  onStop?: () => void
  // Dictation — speech-to-text into THIS composer (edit, then send). Live conversation is a separate
  // top-bar control. `dictating` reflects the shared voice hook's listening state (dictate, not live).
  onStartDictation?: () => void
  onStopDictation?: () => void
  dictating?: boolean
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

// Quiet SVG file glyph for attachment chips — no emoji.
function FileGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path d="M3.5 1.5h4L11 5v7.5H3.5V1.5z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
      <path d="M7.5 1.5V5H11" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
    </svg>
  )
}

function AttachmentChip({ attachment, onRemove }: { attachment: PendingAttachment; onRemove: () => void }) {
  return (
    <div className="flex items-center gap-1.5 rounded-lg border border-[var(--color-border-tertiary)] bg-[var(--color-background-secondary)] px-2 py-1 text-xs">
      <span className="text-[var(--color-text-tertiary)]"><FileGlyph /></span>
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
  onStartDictation, onStopDictation, dictating = false,
  disabled = false,
  fanoutModelCount = 0,
  workspaceMode, onWorkspaceModeChange,
  mcpTools = [],
  modelId, onModelChange, thinkingBudget, onOpenPalette,
  systemPrompt = '', onSystemPromptChange,
  activeProjectTitle, projectCollection, chatCollection,
  projects = [], activeProjectId, onSelectProject,
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
  const [showMore, setShowMore] = useState(false)   // secondary controls hidden by default → bar = attach · model · send
  const [showSystemPrompt, setShowSystemPrompt] = useState(false)
  const [retrievalScope, setRetrievalScope] = useState<RetrievalScope>('project')
  const [webMode, setWebMode] = useState(false)
  // Secret hygiene: a pasted API key would otherwise flow into session persistence,
  // memory extraction, and (worst case) an open-chat publish. Detection on send shows
  // this banner; redact is the default action, send-anyway the explicit override.
  const [secretWarning, setSecretWarning] = useState<{ kinds: string[] } | null>(null)
  const [showScopePicker, setShowScopePicker] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const { settings, update } = useSettings()
  // Which collection new uploads land in: the current chat (when scoped to 'chat') or the active project's KB.
  // Undefined → global inbox (no project active), preserving the pre-Projects behavior.
  const uploadCollection: string | undefined =
    retrievalScope === 'chat' ? chatCollection
    : projectCollection
  const scopeLabel: Record<RetrievalScope, string> = { chat: 'This chat', project: activeProjectTitle ?? 'This chat', everything: 'Everything' }
  const modelList = visibleModels(settings.showAllModels, providersWithKeys(settings))

  const activeModel = modelList.find((m) => m.id === modelId) ?? modelList[0]
  // Short display name: "Sonnet 4.6", "GPT-4o", etc — strip "Claude " prefix
  const modelShortName = (activeModel?.label ?? modelId).replace(/^Claude\s+/i, '')
  const thinkingLabel = thinkingBudget == null ? null
    : thinkingBudget === 0 ? null
    : thinkingBudget <= 5000 ? 'Low'
    : thinkingBudget <= 15000 ? 'Medium'
    : 'High'

  // Dictation lands here: the shared voice hook transcribes, AppShell fires `noetica:dictate`, and the
  // text is appended to the composer so you can edit before sending (not auto-sent — that's the Claude
  // dictate behaviour, distinct from live conversation).
  useEffect(() => {
    const h = (e: Event) => {
      const text = (e as CustomEvent<string>).detail?.trim()
      if (!text) return
      setContent((c) => (c.trim() ? `${c.trimEnd()} ${text}` : text))
      requestAnimationFrame(() => textareaRef.current?.focus())
    }
    window.addEventListener('noetica:dictate', h as EventListener)
    return () => window.removeEventListener('noetica:dictate', h as EventListener)
  }, [])

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
        body: JSON.stringify({ filename: file.name, mimeType: file.type, dataBase64: btoa(bin), collection: uploadCollection }),
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
        for (const p of paths) await postIngest('/api/ingest/path', { path: p, collection: uploadCollection }, p.split('/').pop() ?? p)
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

  async function submit(opts?: { allowSecrets?: boolean; redact?: boolean }) {
    let trimmed = content.trim()
    if ((!trimmed && attachments.length === 0 && ingestedDocs.length === 0) || sending || disabled) return
    // Secret hygiene gate — detect once per send attempt, before anything is persisted.
    const hits = detectSecrets(trimmed)
    if (hits.length > 0) {
      if (opts?.redact) {
        trimmed = redactSecrets(trimmed, hits)
        setSecretWarning(null)
      } else if (!opts?.allowSecrets) {
        setSecretWarning({ kinds: Array.from(new Set(hits.map((h) => h.kind))) })
        return
      } else {
        setSecretWarning(null)
      }
    } else if (secretWarning) {
      setSecretWarning(null)
    }
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
        await onSend(finalContent, toSend, toolsToSend.length > 0 ? toolsToSend : undefined, { retrievalScope, web: webMode })
      }
    } finally {
      setSending(false)
    }
  }

  const canSend = (content.trim().length > 0 || attachments.length > 0 || ingestedDocs.length > 0) && !sending && !disabled
  // Any non-default secondary option active? → show a dot on the ⚙ toggle so hidden state isn't invisible.
  const hasActiveOptions = !!systemPrompt || webMode || selectedTools.length > 0
    || retrievalScope === 'everything'
    || (!!settings.agentMode && settings.agentMode !== 'auto')
    || (!!settings.replyLength && settings.replyLength !== 'medium')

  return (
    <div
      className={`px-4 pb-5 pt-2 transition sm:px-8 ${dragOver ? 'opacity-80' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={async (e) => {
        e.preventDefault()
        setDragOver(false)
        await addFiles(e.dataTransfer.files)
      }}
    >
      {/* Centred 64rem envelope matching the message list; the composer box left-anchors within it
          and reserves the right margin (15rem gutter + 2rem gap) so it sits under the answer column,
          aligned with the reading measure — not under the provenance margin. */}
      <div className="mx-auto w-full max-w-[64rem]">
      <div className={`w-full rounded-2xl border bg-[var(--color-background-primary)] transition lg:w-auto lg:mr-[17rem] ${
        dragOver ? 'border-[var(--color-border-primary)]' : 'border-[var(--color-border-secondary)]'
      }`}>

        {/* Live ingestion queue (bulk/zip uploads → collection scope, parsed-vs-pending) */}
        <div className="px-3 pt-2.5 empty:hidden">
          <IngestQueueTable refreshSignal={queueVersion} />
          <AudioOverviewPlayer refreshSignal={queueVersion} />
        </div>

        {/* Ingested document chips */}
        {ingestedDocs.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-3 pt-2.5">
            {ingestedDocs.map((d, i) => (
              <div key={i} className="flex items-center gap-1.5 rounded-lg border border-[var(--color-accent)] bg-[var(--color-accent-bg)] px-2 py-1 text-xs dark:border-[var(--color-accent)] dark:bg-[rgba(22,101,52,0.15)]">
                <span className="text-[var(--color-accent)]">
                  <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden>
                    <path d="M2 1h5.5L10 3.5V11H2V1z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
                    <path d="M6 1v3h4" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
                  </svg>
                </span>
                <span className="max-w-[140px] truncate text-[var(--color-accent)] dark:text-[#4ade80]">{d.filename}</span>
                <span className="text-[var(--color-accent)] dark:text-[#4ade80]">{d.chunks}ch · {d.entities}ent</span>
                <button
                  onClick={() => setIngestedDocs((prev) => prev.filter((_, j) => j !== i))}
                  className="ml-0.5 text-[var(--color-accent)] hover:text-[var(--color-accent)]"
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

        {/* Secret hygiene: pasted credential detected — redact by default, send-anyway explicit. */}
        {secretWarning && (
          <div className="mx-3 mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-[#fde68a] bg-[var(--color-attention-bg,#fffbeb)] px-2.5 py-1.5 text-xs text-[#854d0e]">
            <span>
              This message looks like it contains a <b>{secretWarning.kinds.join(', ')}</b> credential.
              Keys pasted into chat get saved with the conversation — better to keep them in Settings → Models.
            </span>
            <span className="ml-auto flex gap-2">
              <button
                onClick={() => void submit({ redact: true })}
                className="rounded-md bg-[#854d0e] px-2 py-0.5 font-semibold text-white"
              >
                Redact &amp; send
              </button>
              <button
                onClick={() => void submit({ allowSecrets: true })}
                className="rounded-md border border-[#fde68a] px-2 py-0.5"
              >
                Send anyway
              </button>
              <button onClick={() => setSecretWarning(null)} className="px-1 text-[#a16207]" title="Dismiss">✕</button>
            </span>
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
              <span className="text-[11px] font-medium text-[var(--color-text-tertiary)]">System prompt</span>
              <button
                onClick={() => { setShowSystemPrompt(false); onSystemPromptChange('') }}
                className="text-[11px] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]"
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

        {/* Secondary controls — hidden by default (⚙ toggles). Keeps the resting bar to attach · model · send. */}
        {showMore && (
          <div className="flex flex-wrap items-center gap-1 border-t border-[var(--color-border-tertiary)] px-2 py-1.5">
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

          {/* Web research toggle — force external web search on for the next turn. */}
          <button
            type="button"
            onClick={() => setWebMode((v) => !v)}
            title={webMode ? 'Web research ON — will search the web and prefer fresh external sources' : 'Web research off — answers from your knowledge/documents'}
            style={{ border: 'none', background: 'none', outline: 'none' }}
            className={`flex h-7 items-center gap-1 rounded-md px-1.5 text-[11px] font-medium transition ${webMode ? 'text-[#2563eb]' : 'text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]'}`}
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden>
              <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.3"/>
              <path d="M1.5 8h13M8 1.5c2 2 2 11 0 13M8 1.5c-2 2-2 11 0 13" stroke="currentColor" strokeWidth="1.1"/>
            </svg>
            {webMode ? 'Web' : ''}
          </button>

          {/* Knowledge scope — which documents this chat reads (project isolation). */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowScopePicker((v) => !v)}
              title="Knowledge scope — which documents this chat can read"
              style={{ border: 'none', background: 'none', outline: 'none' }}
              className={`flex h-7 items-center gap-1 rounded-md px-1.5 text-[11px] font-medium transition ${retrievalScope === 'everything' ? 'text-[var(--color-attention)]' : 'text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]'}`}
            >
              <svg width="11" height="11" viewBox="0 0 14 14" fill="none" aria-hidden>
                <path d="M1.5 3.5A1.5 1.5 0 013 2h3l1.2 1.4H12a1 1 0 011 1v6a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 011 10.5v-7z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
              </svg>
              <span className="max-w-[120px] truncate">{scopeLabel[retrievalScope]}</span>
              <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden><path d="M1.5 3l2 2 2-2" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </button>
            {showScopePicker && (
              <div className="absolute bottom-10 right-0 z-50 max-h-80 w-60 overflow-y-auto rounded-xl border border-[var(--color-border-tertiary)] bg-[var(--color-background-primary)] py-1 shadow-lg">
                {/* This chat only */}
                <button
                  type="button"
                  onClick={() => { setRetrievalScope('chat'); setShowScopePicker(false) }}
                  className={`flex w-full flex-col items-start px-3 py-1.5 text-left transition hover:bg-[var(--color-background-secondary)] ${retrievalScope === 'chat' ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)]'}`}
                >
                  <span className="text-[12px] font-medium">This chat only</span>
                  <span className="text-[11px] text-[var(--color-text-tertiary)]">Reads only documents you attach in this conversation</span>
                </button>

                {/* Projects — pick one to scope the conversation to it (and make it active) */}
                {projects.length > 0 && (
                  <div className="px-3 pb-0.5 pt-1.5 text-[11px] font-semibold text-[var(--color-text-tertiary)]">Projects</div>
                )}
                {projects.map((p) => {
                  const on = retrievalScope === 'project' && p.id === activeProjectId
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => { onSelectProject?.(p.id); setRetrievalScope('project'); setShowScopePicker(false) }}
                      className={`flex w-full flex-col items-start px-3 py-1.5 text-left transition hover:bg-[var(--color-background-secondary)] ${on ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)]'}`}
                    >
                      <span className="max-w-full truncate text-[12px] font-medium">{p.title}</span>
                      <span className="text-[11px] text-[var(--color-text-tertiary)]">This chat + this project’s knowledge base</span>
                    </button>
                  )
                })}

                {/* Everything */}
                <button
                  type="button"
                  onClick={() => { setRetrievalScope('everything'); setShowScopePicker(false) }}
                  className={`mt-0.5 flex w-full flex-col items-start border-t border-[var(--color-border-tertiary)] px-3 py-1.5 text-left transition hover:bg-[var(--color-background-secondary)] ${retrievalScope === 'everything' ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)]'}`}
                >
                  <span className="text-[12px] font-medium">Everything</span>
                  <span className="text-[11px] text-[var(--color-text-tertiary)]">Reads across every document you’ve uploaded</span>
                </button>
              </div>
            )}
          </div>

          {/* Agent mode — Auto / Plan / Ask (autonomy level) */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowModePicker((v) => !v)}
              title="Agent mode — how autonomously it acts"
              className={`flex h-7 items-center gap-1 rounded-md border-0 bg-transparent px-1.5 text-[11px] font-medium capitalize outline-none transition ${settings.agentMode === 'plan' ? 'text-[var(--color-attention)]' : settings.agentMode === 'ask' ? 'text-[#0891b2]' : 'text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]'}`}
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
                    <span className="text-[11px] text-[var(--color-text-tertiary)]">{desc}</span>
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

          </div>
        )}

        {/* Bottom toolbar — attach · more · model · send */}
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

          {/* Dictate — speech-to-text into the composer (edit, then send). Live conversation is separate,
              at the top. */}
          {onStartDictation && (
            <button
              type="button"
              onClick={() => (dictating ? onStopDictation?.() : onStartDictation())}
              title={dictating ? 'Listening… click to stop' : 'Dictate — speak, and it types into the box'}
              aria-label="Dictate"
              style={{ border: 'none', background: 'none', outline: 'none' }}
              className={`relative flex h-7 w-7 items-center justify-center rounded-md transition ${
                dictating ? 'text-[#f43f5e]' : 'text-[var(--color-text-tertiary)] hover:bg-[var(--color-background-secondary)] hover:text-[var(--color-text-secondary)]'
              }`}
            >
              {dictating && <span className="absolute inset-0 rounded-md bg-[#fda4af] opacity-30 animate-ping" />}
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
                <rect x="6" y="1" width="4" height="8" rx="2" stroke="currentColor" strokeWidth="1.5"/>
                <path d="M3 8a5 5 0 0 0 10 0M8 13v2M6 15h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </button>
          )}

          {/* More options — reveals the secondary controls (tools, web, scope, mode, length) */}
          <button
            type="button"
            onClick={() => setShowMore((v) => !v)}
            title="More — tools, web research, knowledge scope, agent mode, reply length"
            style={{ border: 'none', background: 'none', outline: 'none' }}
            className={`relative flex h-7 w-7 items-center justify-center rounded-md transition ${showMore ? 'bg-[var(--color-background-secondary)] text-[var(--color-text-secondary)]' : 'text-[var(--color-text-tertiary)] hover:bg-[var(--color-background-secondary)] hover:text-[var(--color-text-secondary)]'}`}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path d="M2 5h6M11 5h3M2 11h3M8 11h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              <circle cx="9.5" cy="5" r="1.7" stroke="currentColor" strokeWidth="1.4"/>
              <circle cx="6.5" cy="11" r="1.7" stroke="currentColor" strokeWidth="1.4"/>
            </svg>
            {hasActiveOptions && !showMore && <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-[#2563eb]" aria-hidden />}
          </button>
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
                  <span className="ml-1 text-[11px] text-[var(--color-text-tertiary)]">{thinkingLabel}</span>
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
