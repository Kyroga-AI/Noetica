'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useCanvas } from '@/lib/canvas/useCanvas'
import { useSettings } from '@/lib/settings/context'
import { sendNoeticaChat } from '@/lib/client/noeticaTransport'
import type { CanvasDocument } from '@/lib/types/canvas'
import type { ChatMessage } from '@/lib/types/message'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length
}

// ─── Markdown preview (simple) ────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function MarkdownPreview({ content }: { content: string }) {
  const lines = content.split('\n')
  return (
    <div className="min-h-full space-y-1 text-sm leading-7 text-[var(--color-text-primary)]">
      {lines.map((line, i) => {
        if (line.startsWith('# '))   return <h1 key={i} className="text-2xl font-bold mt-4 mb-2">{line.slice(2)}</h1>
        if (line.startsWith('## '))  return <h2 key={i} className="text-xl font-semibold mt-3 mb-1">{line.slice(3)}</h2>
        if (line.startsWith('### ')) return <h3 key={i} className="text-base font-semibold mt-2 mb-1">{line.slice(4)}</h3>
        if (line.startsWith('> '))   return <blockquote key={i} className="border-l-2 border-[#93c5fd] pl-3 text-[var(--color-text-secondary)] italic">{line.slice(2)}</blockquote>
        if (line.startsWith('- ') || line.startsWith('* ')) return <li key={i} className="ml-4 list-disc">{line.slice(2)}</li>
        if (/^\d+\. /.test(line)) return <li key={i} className="ml-4 list-decimal">{line.replace(/^\d+\. /, '')}</li>
        if (line === '') return <div key={i} className="h-3" />
        // Escape HTML first so user content can never inject tags, then apply safe inline markup.
        const safe = escapeHtml(line)
        const rendered = safe
          .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
          .replace(/\*(.+?)\*/g, '<em>$1</em>')
          .replace(/`(.+?)`/g, '<code class="bg-[var(--color-background-secondary)] px-1 py-0.5 rounded text-xs font-mono">$1</code>')
        return <p key={i} dangerouslySetInnerHTML={{ __html: rendered }} />
      })}
    </div>
  )
}

// ─── Canvas editor ────────────────────────────────────────────────────────────

function CanvasEditor({ doc, onUpdate }: { doc: CanvasDocument; onUpdate: (patch: Partial<CanvasDocument>) => void }) {
  const [mode, setMode] = useState<'edit' | 'preview'>('edit')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Cmd/Ctrl+B, I, etc. formatting shortcuts
  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (!(e.metaKey || e.ctrlKey)) return
    const el = e.currentTarget
    const start = el.selectionStart
    const end = el.selectionEnd
    const sel = el.value.slice(start, end)

    let wrap = ''
    if (e.key === 'b') { e.preventDefault(); wrap = '**' }
    if (e.key === 'i') { e.preventDefault(); wrap = '_' }
    if (!wrap) return

    const before = el.value.slice(0, start)
    const after = el.value.slice(end)
    const newVal = `${before}${wrap}${sel}${wrap}${after}`
    onUpdate({ content: newVal })
    setTimeout(() => {
      el.selectionStart = start + wrap.length
      el.selectionEnd = end + wrap.length
    }, 0)
  }

  function insertAtCursor(prefix: string) {
    const el = textareaRef.current
    if (!el) return
    const start = el.selectionStart
    const before = el.value.slice(0, start)
    const after = el.value.slice(start)
    const newVal = `${before}${prefix}${after}`
    onUpdate({ content: newVal })
    setTimeout(() => {
      el.selectionStart = el.selectionEnd = start + prefix.length
      el.focus()
    }, 0)
  }

  function download() {
    const slug = doc.title.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'canvas'
    const blob = new Blob([doc.content], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = `${slug}.md`; a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Title */}
      <div className="border-b border-[var(--color-border-secondary)] px-6 py-4">
        <input
          className="w-full border-0 bg-transparent text-2xl font-bold text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-tertiary)]"
          placeholder="Document title…"
          value={doc.title}
          onChange={(e) => onUpdate({ title: e.target.value })}
        />
        <div className="mt-1 text-[11px] text-[var(--color-text-tertiary)]">
          {wordCount(doc.content)} words · updated {timeAgo(doc.updatedAt)}
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-1 border-b border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] px-4 py-1.5">
        {/* Mode toggle */}
        <div className="flex items-center gap-0.5 rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] p-0.5 mr-2">
          {(['edit', 'preview'] as const).map((m) => (
            <button key={m} onClick={() => setMode(m)}
              className={`rounded-md px-2.5 py-0.5 text-xs font-medium transition capitalize ${mode === m ? 'bg-[#dbeafe] text-[#1d4ed8]' : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'}`}>
              {m}
            </button>
          ))}
        </div>

        {/* Formatting shortcuts */}
        {mode === 'edit' && (
          <>
            <button onClick={() => insertAtCursor('# ')} title="Heading 1" className="rounded px-2 py-1 text-xs font-bold text-[var(--color-text-secondary)] hover:bg-[var(--color-background-tertiary)]">H1</button>
            <button onClick={() => insertAtCursor('## ')} title="Heading 2" className="rounded px-2 py-1 text-xs font-bold text-[var(--color-text-secondary)] hover:bg-[var(--color-background-tertiary)]">H2</button>
            <div className="mx-1 h-4 w-px bg-[var(--color-border-secondary)]" />
            <button onClick={() => { const el = textareaRef.current; if (el) { const s = el.selectionStart; const e2 = el.selectionEnd; const sel = el.value.slice(s, e2); const v = el.value.slice(0, s) + `**${sel}**` + el.value.slice(e2); onUpdate({ content: v }) } }} title="Bold (⌘B)" className="rounded px-2 py-1 text-xs font-bold text-[var(--color-text-secondary)] hover:bg-[var(--color-background-tertiary)]">B</button>
            <button onClick={() => { const el = textareaRef.current; if (el) { const s = el.selectionStart; const e2 = el.selectionEnd; const sel = el.value.slice(s, e2); const v = el.value.slice(0, s) + `_${sel}_` + el.value.slice(e2); onUpdate({ content: v }) } }} title="Italic (⌘I)" className="rounded px-2 py-1 text-xs italic text-[var(--color-text-secondary)] hover:bg-[var(--color-background-tertiary)]">I</button>
            <button onClick={() => insertAtCursor('- ')} title="Bullet list" className="rounded px-2 py-1 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-background-tertiary)]">•—</button>
            <button onClick={() => insertAtCursor('> ')} title="Blockquote" className="rounded px-2 py-1 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-background-tertiary)]">&quot;</button>
            <button onClick={() => insertAtCursor('`')} title="Inline code" className="rounded px-2 py-1 font-mono text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-background-tertiary)]">`</button>
          </>
        )}

        <div className="flex-1" />
        <button onClick={download} title="Download as .md" className="flex h-6 w-6 items-center justify-center rounded text-[var(--color-text-tertiary)] hover:bg-[var(--color-background-tertiary)] hover:text-[var(--color-text-secondary)]">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
            <path d="M6 1v7M3 5.5l3 3 3-3M2 10.5h8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
      </div>

      {/* Editor / Preview */}
      {mode === 'edit' ? (
        <textarea
          ref={textareaRef}
          className="min-h-0 flex-1 resize-none bg-[var(--color-background-primary)] px-6 py-5 font-mono text-sm leading-7 text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-tertiary)]"
          placeholder={`Start writing…\n\n# Use markdown formatting\n\n**Bold**, _italic_, \`code\`\n\n- Lists work too\n\nTip: ask Claude to write or edit this document in the chat panel →`}
          value={doc.content}
          onChange={(e) => onUpdate({ content: e.target.value })}
          onKeyDown={handleKeyDown}
          spellCheck
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {doc.content ? <MarkdownPreview content={doc.content} /> : (
            <p className="text-sm text-[var(--color-text-tertiary)]">Nothing to preview yet.</p>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Chat sidebar ─────────────────────────────────────────────────────────────

function CanvasChat({ doc, onDocUpdate }: {
  doc: CanvasDocument
  onDocUpdate: (patch: Partial<CanvasDocument>) => void
}) {
  const { settings } = useSettings()
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const historyRef = useRef<Map<string, ChatMessage[]>>(new Map())
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const thinkingRef = useRef<string>('')
  const bottomRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  // Abort in-flight stream on unmount
  useEffect(() => () => { abortRef.current?.abort() }, [])

  // Abort in-flight stream and restore history when switching docs
  useEffect(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setStreaming(false)
    setMessages(historyRef.current.get(doc.id) ?? [])
    thinkingRef.current = ''
  }, [doc.id])

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  function setAndPersistMessages(updater: (prev: ChatMessage[]) => ChatMessage[]) {
    setMessages((prev) => {
      const next = updater(prev)
      historyRef.current.set(doc.id, next)
      return next
    })
  }

  const canvasWriteTool = {
    name: 'canvas_write',
    description: 'Write or replace the content of the active canvas document. Use this to draft, rewrite, or extend the document.',
    input_schema: {
      type: 'object' as const,
      properties: {
        content: { type: 'string', description: 'The full markdown content to write into the canvas.' },
        title:   { type: 'string', description: 'Optional new title for the canvas document.' },
      },
      required: ['content'],
    },
  }

  async function send() {
    const trimmed = input.trim()
    if (!trimmed || streaming) return

    const userMsg: ChatMessage = { id: crypto.randomUUID(), role: 'user', content: trimmed, created_at: new Date().toISOString() }
    const assistantId = crypto.randomUUID()
    const assistantMsg: ChatMessage = { id: assistantId, role: 'assistant', content: '', created_at: new Date().toISOString() }

    const systemMsg: ChatMessage = {
      id: 'canvas-system',
      role: 'system',
      content: `You are a collaborative writing assistant. The user is editing a document in their canvas.\n\nCurrent document title: ${doc.title}\n\nCurrent content:\n${doc.content || '(empty)'}\n\nWhen asked to write or significantly change the document, use the canvas_write tool to write the new content directly into the canvas. For short answers or questions, just reply normally.`,
      created_at: new Date().toISOString(),
    }

    const history = [...messages, userMsg]
    setAndPersistMessages((prev) => [...prev, userMsg, assistantMsg])
    setInput('')
    setStreaming(true)

    const providerKeys = {
      anthropic:   settings.anthropicApiKey   || undefined,
      openai:      settings.openaiApiKey      || undefined,
      google:      settings.googleApiKey      || undefined,
      mistral:     settings.mistralApiKey     || undefined,
      neuronpedia: settings.neuronpediaApiKey || undefined,
    }
    const agentMachineEndpoint =
      settings.runtimeMode === 'agent-machine' && settings.agentMachineEndpoint
        ? settings.agentMachineEndpoint : undefined

    const abort = new AbortController()
    abortRef.current = abort

    let toolCallBuffer: { id: string; name: string; input: string } | null = null
    let finalContent = ''
    thinkingRef.current = ''

    try {
      await sendNoeticaChat(
        {
          session_id: `canvas:${doc.id}`,
          mode: 'standalone',
          model_id: settings.defaultModelId,
          messages: [systemMsg, ...history],
          tools: [canvasWriteTool],
          memory_scope: `noetica-canvas:${doc.id}`,
          provider_keys: providerKeys,
          agent_machine_endpoint: agentMachineEndpoint,
        },
        {
          onMeta: () => {},
          onThinkingDelta: (delta) => {
            thinkingRef.current += delta
            setAndPersistMessages((prev) =>
              prev.map((m) => m.id === assistantId ? { ...m, thinking: (m.thinking ?? '') + delta } : m)
            )
          },
          onThinkingDone: (thinking) => { thinkingRef.current = thinking },
          onDelta: (delta) => {
            finalContent += delta
            setAndPersistMessages((prev) =>
              prev.map((m) => m.id === assistantId ? { ...m, content: m.content + delta } : m)
            )
          },
          onToolCalls: (calls) => {
            if (calls[0]) {
              toolCallBuffer = { id: calls[0].id, name: calls[0].name, input: JSON.stringify(calls[0].input) }
            }
          },
          onDone: () => {
            // Handle canvas_write tool call
            if (toolCallBuffer?.name === 'canvas_write') {
              try {
                const args = JSON.parse(toolCallBuffer.input) as { content: string; title?: string }
                onDocUpdate({ content: args.content, ...(args.title ? { title: args.title } : {}) })
                setAndPersistMessages((prev) =>
                  prev.map((m) => m.id === assistantId
                    ? {
                        ...m,
                        content: m.content || `I've updated the canvas document${args.title ? ` and renamed it to "${args.title}"` : ''}.`,
                        ...(thinkingRef.current ? { thinking: thinkingRef.current } : {}),
                      }
                    : m
                  )
                )
              } catch {
                // malformed tool args — leave as-is
              }
              toolCallBuffer = null
            }
          },
          onError: (err) => {
            setAndPersistMessages((prev) =>
              prev.map((m) => m.id === assistantId ? { ...m, content: `Error: ${err}` } : m)
            )
          },
        },
        {},
        abort.signal
      )
    } finally {
      abortRef.current = null
      setStreaming(false)
    }
  }

  function stop() {
    abortRef.current?.abort()
    abortRef.current = null
    setStreaming(false)
  }

  return (
    <div className="flex w-80 shrink-0 flex-col border-l border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)]">
      <div className="flex items-center justify-between border-b border-[var(--color-border-secondary)] px-4 py-3">
        <div>
          <p className="text-xs font-semibold text-[var(--color-text-primary)]">Canvas AI</p>
          <p className="text-[11px] text-[var(--color-text-tertiary)]">Ask Claude to write or edit</p>
        </div>
        {messages.length > 0 && (
          <span className="rounded-full bg-[#eff6ff] px-2 py-0.5 text-[10px] font-semibold text-[#1d4ed8]">{messages.length}</span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {messages.length === 0 ? (
          <div className="py-8 text-center">
            <p className="text-xs font-medium text-[var(--color-text-secondary)]">Co-write with Claude</p>
            <p className="mt-1 text-[11px] text-[var(--color-text-tertiary)]">Ask Claude to draft, rewrite, extend, or critique — it writes directly into the canvas.</p>
            <div className="mt-4 space-y-1.5">
              {['Write a blog post about this topic', 'Summarise and compress', 'Make this more concise', 'Add an introduction'].map((s) => (
                <button key={s} onClick={() => setInput(s)}
                  className="block w-full rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-3 py-1.5 text-left text-[11px] text-[var(--color-text-secondary)] transition hover:border-[#bfdbfe] hover:text-[#1d4ed8]">
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m) => (
            <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              {m.role === 'assistant' && (
                <div className="mr-2 mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#0f172a] text-[10px] font-bold text-white">N</div>
              )}
              <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-xs leading-5 ${
                m.role === 'user'
                  ? 'bg-[#dbeafe] text-[var(--color-text-primary)]'
                  : 'border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] shadow-sm text-[var(--color-text-primary)]'
              }`}>
                <p className="whitespace-pre-wrap">{m.content || (streaming ? '…' : '')}</p>
              </div>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>

      <div className="border-t border-[var(--color-border-secondary)] p-3">
        <div className="flex items-end gap-2 rounded-xl border border-[#bfdbfe] bg-[var(--color-background-primary)] p-2 shadow-sm">
          <textarea
            className="min-h-[2.5rem] flex-1 resize-none bg-transparent text-xs leading-5 text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-tertiary)]"
            placeholder="Ask Claude to write…"
            value={input}
            disabled={streaming}
            onChange={(e) => setInput(e.target.value)}
            rows={2}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void send() }}
          />
          {streaming ? (
            <button
              onClick={stop}
              className="shrink-0 rounded-lg bg-[#ef4444] px-3 py-1.5 text-[11px] font-semibold text-white transition hover:bg-[#dc2626]"
              title="Stop generation"
            >
              Stop
            </button>
          ) : (
            <button
              onClick={() => void send()}
              disabled={!input.trim()}
              className="shrink-0 rounded-lg bg-[#1d4ed8] px-3 py-1.5 text-[11px] font-semibold text-white transition hover:bg-[#1e40af] disabled:cursor-not-allowed disabled:opacity-50"
            >
              Ask
            </button>
          )}
        </div>
        <p className="mt-1.5 text-center text-[10px] text-[#cbd5e1]">⌘ + Enter</p>
      </div>
    </div>
  )
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
      <div className="rounded-2xl border border-dashed border-[#bfdbfe] bg-[#eff6ff] p-10">
        <p className="text-3xl mb-3">✏️</p>
        <p className="text-sm font-semibold text-[var(--color-text-secondary)]">No document open</p>
        <p className="mt-1 text-xs text-[var(--color-text-secondary)] max-w-xs leading-5">
          Canvas is a collaborative document editor. Create a document and ask Claude to write, edit, or extend it directly.
        </p>
        <button
          onClick={onCreate}
          className="mt-4 rounded-xl bg-[#1d4ed8] px-5 py-2 text-sm font-semibold text-white transition hover:bg-[#1e40af]"
        >
          New document
        </button>
      </div>
    </div>
  )
}

// ─── Main surface ─────────────────────────────────────────────────────────────

export function CanvasSurface() {
  const { hydrated, documents, activeDocument, activeDocumentId, createDocument, updateDocument, deleteDocument, setActiveDocument, pinDocument } = useCanvas()
  const [search, setSearch] = useState('')
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null)

  const filtered = search.trim()
    ? documents.filter((d) =>
        d.title.toLowerCase().includes(search.toLowerCase()) ||
        d.content.toLowerCase().includes(search.toLowerCase())
      )
    : documents

  function handleCreate() {
    const doc = createDocument()
    setActiveDocument(doc.id)
  }

  const handleUpdate = useCallback((id: string, patch: Partial<CanvasDocument>) => {
    updateDocument(id, patch)
  }, [updateDocument])

  function handleDelete(id: string) {
    deleteDocument(id)
    setShowDeleteConfirm(null)
  }

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      {/* ── Sidebar ── */}
      <aside className="flex w-56 shrink-0 flex-col border-r border-[var(--color-border-secondary)] bg-[#eaf1f8]">
        <div className="flex items-center justify-between border-b border-[var(--color-border-secondary)] px-3 py-3">
          <span className="text-xs font-semibold uppercase tracking-wide text-[#1d4ed8]">Canvas</span>
          <button
            onClick={handleCreate}
            className="flex h-6 w-6 items-center justify-center rounded-lg text-[var(--color-text-secondary)] transition hover:bg-[var(--color-background-primary)] hover:text-[#1d4ed8]"
            title="New document"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
              <path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        <div className="px-3 py-2">
          <input
            className="w-full rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-2.5 py-1.5 text-xs outline-none placeholder:text-[var(--color-text-tertiary)] focus:border-[#93c5fd]"
            placeholder="Search documents…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="flex-1 overflow-y-auto px-2 py-1 space-y-0.5">
          {!hydrated && <p className="px-2 py-4 text-center text-xs text-[var(--color-text-tertiary)]">Loading…</p>}
          {hydrated && filtered.length === 0 && (
            <p className="px-2 py-4 text-center text-xs text-[var(--color-text-tertiary)]">{search ? 'No matches' : 'No documents'}</p>
          )}
          {filtered.map((doc) => {
            const active = doc.id === activeDocumentId
            const preview = doc.content.replace(/[#*`_\[\]>]/g, '').slice(0, 60).trim()
            return (
              <div key={doc.id} className="group relative">
                <button
                  onClick={() => setActiveDocument(doc.id)}
                  className={`flex w-full flex-col gap-0.5 rounded-xl px-3 py-2.5 text-left transition ${active ? 'bg-[#dbeafe]' : 'hover:bg-[var(--color-background-tertiary)]'}`}
                >
                  <div className="flex items-center gap-1.5">
                    {doc.pinned && <span className="text-[10px] text-[#f59e0b]">★</span>}
                    <span className={`truncate text-sm font-medium ${active ? 'text-[#1d4ed8]' : 'text-[var(--color-text-primary)]'}`}>{doc.title}</span>
                  </div>
                  <p className="truncate text-xs text-[var(--color-text-tertiary)]">{preview || 'Empty document'}</p>
                  <p className="text-[10px] text-[#cbd5e1]">{timeAgo(doc.updatedAt)}</p>
                </button>

                {/* Hover actions */}
                <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition">
                  <button onClick={(e) => { e.stopPropagation(); pinDocument(doc.id, !doc.pinned) }} title={doc.pinned ? 'Unpin' : 'Pin'}
                    className="flex h-5 w-5 items-center justify-center rounded text-[var(--color-text-tertiary)] hover:bg-[var(--color-background-primary)] hover:text-[#f59e0b]">
                    <span className="text-[10px]">★</span>
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); setShowDeleteConfirm(doc.id) }} title="Delete"
                    className="flex h-5 w-5 items-center justify-center rounded text-[var(--color-text-tertiary)] hover:bg-[var(--color-background-primary)] hover:text-[#dc2626]">
                    <svg width="9" height="9" viewBox="0 0 10 10" fill="none" aria-hidden>
                      <path d="M1 1l8 8M9 1L1 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                    </svg>
                  </button>
                </div>

                {showDeleteConfirm === doc.id && (
                  <div className="absolute left-0 right-0 z-10 top-full mt-1 mx-2 rounded-xl border border-[#fecaca] bg-[var(--color-background-primary)] p-3 shadow-lg">
                    <p className="text-xs font-medium text-[var(--color-text-primary)]">Delete this document?</p>
                    <p className="mt-0.5 text-[11px] text-[var(--color-text-secondary)]">This cannot be undone.</p>
                    <div className="mt-2 flex gap-2">
                      <button onClick={() => handleDelete(doc.id)} className="flex-1 rounded-lg bg-[#dc2626] py-1 text-xs font-semibold text-white hover:bg-[#b91c1c]">Delete</button>
                      <button onClick={() => setShowDeleteConfirm(null)} className="flex-1 rounded-lg border border-[var(--color-border-secondary)] py-1 text-xs font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-background-secondary)]">Cancel</button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {hydrated && documents.length > 0 && (
          <div className="border-t border-[var(--color-border-secondary)] px-3 py-2 text-[10px] text-[var(--color-text-tertiary)]">
            {documents.length} document{documents.length !== 1 ? 's' : ''}
          </div>
        )}
      </aside>

      {/* ── Main area ── */}
      {activeDocument ? (
        <>
          <CanvasEditor
            doc={activeDocument}
            onUpdate={(patch) => handleUpdate(activeDocument.id, patch)}
          />
          <CanvasChat
            doc={activeDocument}
            onDocUpdate={(patch) => handleUpdate(activeDocument.id, patch)}
          />
        </>
      ) : (
        <EmptyState onCreate={handleCreate} />
      )}
    </div>
  )
}
