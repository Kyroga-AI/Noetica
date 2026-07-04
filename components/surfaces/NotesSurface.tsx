'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import oneDark from 'react-syntax-highlighter/dist/cjs/styles/prism/one-dark'
import { useNotes } from '@/lib/notes/useNotes'
import { useSettings } from '@/lib/settings/context'
import { useConnectorAuth } from '@/lib/auth/context'
import { fetchNotionPages, fetchNotionPageContent, createNotionPage, type NotionPage } from '@/lib/auth/providers/notion'
import { sendNoeticaChat } from '@/lib/client/noeticaTransport'
import type { Note } from '@/lib/types/note'
import type { ChatMessage } from '@/lib/types/message'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function amUrl(path: string): string {
  const isTauri = typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)
  return isTauri ? `http://127.0.0.1:8080${path}` : path
}

interface LinkSuggestion { id: string; label: string; sim: number }

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

// ─── Note list ────────────────────────────────────────────────────────────────

function NoteListItem({ note, active, onClick }: { note: Note; active: boolean; onClick: () => void }) {
  const preview = note.body.replace(/[#*`_\[\]]/g, '').slice(0, 80).trim()
  return (
    <button
      onClick={onClick}
      className={`flex w-full flex-col gap-0.5 rounded-xl px-3 py-2.5 text-left transition ${
        active ? 'bg-[#dbeafe]' : 'hover:bg-[var(--color-background-tertiary)]'
      }`}
    >
      <div className="flex items-center gap-1.5">
        {note.pinned && <span className="text-[10px] text-[#f59e0b]">★</span>}
        <span className={`truncate text-sm font-medium ${active ? 'text-[#1d4ed8]' : 'text-[var(--color-text-primary)]'}`}>
          {note.title || 'Untitled'}
        </span>
        {note.messages.length > 0 && (
          <span className="ml-auto shrink-0 rounded-full bg-[#eff6ff] px-1.5 text-[10px] font-semibold text-[#1d4ed8]">
            {note.messages.length}
          </span>
        )}
      </div>
      <p className="truncate text-xs text-[var(--color-text-tertiary)]">{preview || 'Empty note'}</p>
      <p className="text-[10px] text-[#cbd5e1]">{timeAgo(note.updatedAt)}</p>
    </button>
  )
}

// ─── Note editor ──────────────────────────────────────────────────────────────

function NoteEditor({ note, onUpdate }: { note: Note; onUpdate: (patch: Partial<Note>) => void }) {
  const [preview, setPreview] = useState(false)
  const [tagInput, setTagInput] = useState('')
  const [linkSuggestions, setLinkSuggestions] = useState<LinkSuggestion[]>([])
  const [syncing, setSyncing] = useState(false)
  const [syncDone, setSyncDone] = useState(false)
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const suggestTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    // Auto-resize textarea
    const el = bodyRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [note.body])

  // Debounced link suggestions — fires 800ms after the body stops changing
  useEffect(() => {
    if (suggestTimerRef.current) clearTimeout(suggestTimerRef.current)
    const text = note.body.trim()
    if (text.length < 20) { setLinkSuggestions([]); return }
    suggestTimerRef.current = setTimeout(() => {
      fetch(amUrl('/api/knowledge/link-suggestions'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: text.slice(0, 2000), topK: 5 }),
        signal: AbortSignal.timeout(5000),
      })
        .then(r => r.ok ? r.json() : null)
        .then((d: { suggestions?: LinkSuggestion[] } | null) => { if (d?.suggestions) setLinkSuggestions(d.suggestions) })
        .catch(() => { /* embedder unavailable — best-effort */ })
    }, 800)
    return () => { if (suggestTimerRef.current) clearTimeout(suggestTimerRef.current) }
  }, [note.body])

  // Insert [[label]] at current cursor position in the textarea
  function insertLink(label: string) {
    const el = bodyRef.current
    if (!el) return
    const pos = el.selectionStart
    const insertion = `[[${label}]]`
    const next = note.body.slice(0, pos) + insertion + note.body.slice(pos)
    onUpdate({ body: next })
    setTimeout(() => { el.focus(); el.setSelectionRange(pos + insertion.length, pos + insertion.length) }, 0)
    setLinkSuggestions((prev) => prev.filter((s) => s.label !== label))
  }

  // Sync the current note into the knowledge graph via the ingestion pipeline
  async function syncToGraph() {
    if (syncing) return
    setSyncing(true); setSyncDone(false)
    try {
      const markdown = `# ${note.title}\n\n${note.body}`
      const arr = new TextEncoder().encode(markdown)
      let bin = ''
      for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]!)
      await fetch(amUrl('/api/ingest/queue'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          filename: `notes/${note.id}.md`,
          mimeType: 'text/markdown',
          dataBase64: btoa(bin),
        }),
        signal: AbortSignal.timeout(8000),
      })
      setSyncDone(true)
      setTimeout(() => setSyncDone(false), 4000)
    } catch { /* best-effort */ }
    finally { setSyncing(false) }
  }

  function addTag(e: React.KeyboardEvent<HTMLInputElement>) {
    if ((e.key === 'Enter' || e.key === ',') && tagInput.trim()) {
      e.preventDefault()
      const tag = tagInput.trim().replace(/,/g, '')
      if (!note.tags.includes(tag)) onUpdate({ tags: [...note.tags, tag] })
      setTagInput('')
    }
  }

  function removeTag(tag: string) {
    onUpdate({ tags: note.tags.filter((t) => t !== tag) })
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-8 py-6">
      {/* Title */}
      <input
        className="mb-4 w-full border-0 bg-transparent text-2xl font-bold text-[var(--color-text-primary)] outline-none placeholder:text-[#cbd5e1]"
        placeholder="Note title"
        value={note.title}
        onChange={(e) => onUpdate({ title: e.target.value })}
      />

      {/* Tags */}
      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        {note.tags.map((tag) => (
          <span key={tag} className="flex items-center gap-1 rounded-full bg-[#eff6ff] px-2.5 py-0.5 text-xs font-medium text-[#1d4ed8]">
            {tag}
            <button onClick={() => removeTag(tag)} className="ml-0.5 text-[var(--color-text-tertiary)] hover:text-[#dc2626]">×</button>
          </span>
        ))}
        <input
          className="h-6 min-w-[80px] rounded-full border border-dashed border-[#bfdbfe] bg-transparent px-2.5 text-xs text-[var(--color-text-secondary)] outline-none placeholder:text-[#cbd5e1] focus:border-[#1d4ed8]"
          placeholder="Add tag…"
          value={tagInput}
          onChange={(e) => setTagInput(e.target.value)}
          onKeyDown={addTag}
        />
      </div>

      {/* Preview toggle + toolbar */}
      <div className="mb-3 flex items-center gap-2">
        <div className="flex items-center gap-1 rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] p-0.5">
          <button onClick={() => setPreview(false)}
            className={`rounded-md px-3 py-1 text-xs font-medium transition ${!preview ? 'bg-[var(--color-background-primary)] shadow-sm text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'}`}>
            Edit
          </button>
          <button onClick={() => setPreview(true)}
            className={`rounded-md px-3 py-1 text-xs font-medium transition ${preview ? 'bg-[var(--color-background-primary)] shadow-sm text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'}`}>
            Preview
          </button>
        </div>
        {/* Sync to knowledge graph */}
        <button
          onClick={() => void syncToGraph()}
          disabled={syncing || !note.body.trim()}
          title="Index this note in your knowledge graph so the agent can recall it"
          className={`flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-medium transition disabled:opacity-40 ${syncDone ? 'border-[#bbf7d0] bg-[#f0fdf4] text-[#16a34a]' : 'border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] text-[var(--color-text-secondary)] hover:border-[#1d4ed8] hover:text-[#1d4ed8]'}`}
        >
          <span>{syncDone ? '✓' : '⬡'}</span>
          <span>{syncing ? 'Indexing…' : syncDone ? 'Indexed' : 'Index'}</span>
        </button>
        {/* Download */}
        <button
          onClick={() => {
            const slug = note.title.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'note'
            const blob = new Blob([`# ${note.title}\n\n${note.body}`], { type: 'text/markdown;charset=utf-8' })
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a'); a.href = url; a.download = `${slug}.md`; a.click()
            URL.revokeObjectURL(url)
          }}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--color-text-tertiary)] transition hover:bg-[var(--color-background-secondary)] hover:text-[var(--color-text-secondary)]"
          title="Download as markdown"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
            <path d="M6 1v7M3 5.5l3 3 3-3M2 10.5h8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
      </div>

      {/* Body */}
      {preview ? (
        <div className="min-h-48 rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] p-4 text-sm leading-7 text-[var(--color-text-primary)] whitespace-pre-wrap">
          {note.body || <span className="text-[var(--color-text-tertiary)]">Nothing to preview.</span>}
        </div>
      ) : (
        <textarea
          ref={bodyRef}
          className="min-h-48 w-full resize-none border-0 bg-transparent text-sm leading-7 text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-tertiary)]"
          placeholder={`Write your note in markdown…\n\n# Heading\n\n**Bold**, _italic_, \`code\`\n\n- List item`}
          value={note.body}
          onChange={(e) => onUpdate({ body: e.target.value })}
        />
      )}

      {/* Link suggestions — semantically similar graph nodes surfaced as you write */}
      {linkSuggestions.length > 0 && !preview && (
        <div className="mt-4 rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] px-3 py-2.5">
          <div className="mb-2 flex items-center gap-1.5">
            <span className="text-[10px] text-[var(--color-accent)]">⬡</span>
            <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--color-text-tertiary)]">Related in your graph</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {linkSuggestions.map((s) => (
              <button
                key={s.id}
                onClick={() => insertLink(s.label)}
                title={`Insert [[${s.label}]] — ${(s.sim * 100).toFixed(0)}% similarity`}
                className="flex items-center gap-1 rounded-full border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-2.5 py-0.5 text-xs text-[var(--color-text-secondary)] transition hover:border-[#1d4ed8] hover:bg-[#eff6ff] hover:text-[#1d4ed8]"
              >
                <span className="font-mono text-[9px] text-[var(--color-text-tertiary)]">{(s.sim * 100).toFixed(0)}%</span>
                {s.label}
                <span className="text-[10px] text-[var(--color-text-tertiary)]">+</span>
              </button>
            ))}
          </div>
          <div className="mt-1.5 text-[9px] text-[var(--color-text-tertiary)]">Click to insert as backlink · [[label]] syntax</div>
        </div>
      )}
    </div>
  )
}

// ─── Note chat ────────────────────────────────────────────────────────────────

function NoteChat({ note, onAppendMessages }: {
  note: Note
  onAppendMessages: (msgs: ChatMessage[]) => void
}) {
  const { settings } = useSettings()
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>(note.messages)
  const thinkingRef = useRef<string>('')
  const bottomRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  // Abort in-flight stream on unmount
  useEffect(() => () => { abortRef.current?.abort() }, [])

  // Sync when note changes
  useEffect(() => { setMessages(note.messages) }, [note.id])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function send() {
    const trimmed = input.trim()
    if (!trimmed || streaming) return

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(), role: 'user', content: trimmed,
      created_at: new Date().toISOString(),
    }
    const assistantId = crypto.randomUUID()
    const assistantMsg: ChatMessage = {
      id: assistantId, role: 'assistant', content: '',
      created_at: new Date().toISOString(),
    }

    const systemNote: ChatMessage = {
      id: 'note-system',
      role: 'system',
      content: `You are a helpful assistant. The user is working on the following note — use it as context for your responses. You may be asked to summarise, extend, critique, or answer questions about it.\n\n# ${note.title}\n\n${note.body || '(empty note)'}`,
      created_at: new Date().toISOString(),
    }

    abortRef.current?.abort()
    const abort = new AbortController()
    abortRef.current = abort
    thinkingRef.current = ''
    setMessages((prev) => [...prev, userMsg, assistantMsg])
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

    const history = [...messages, userMsg]

    try {
      await sendNoeticaChat(
        {
          session_id: `note:${note.id}`,
          mode: 'standalone',
          model_id: note.modelId ?? settings.defaultModelId,
          messages: [systemNote, ...history],
          memory_scope: `noetica-note:${note.id}`,
          provider_keys: providerKeys,
          agent_machine_endpoint: agentMachineEndpoint,
        },
        {
          onMeta: () => {},
          onThinkingDelta: (delta) => {
            thinkingRef.current += delta
            setMessages((prev) =>
              prev.map((m) => m.id === assistantId ? { ...m, thinking: (m.thinking ?? '') + delta } : m)
            )
          },
          onThinkingDone: (thinking) => {
            thinkingRef.current = thinking
          },
          onDelta: (delta) => {
            setMessages((prev) =>
              prev.map((m) => m.id === assistantId ? { ...m, content: m.content + delta } : m)
            )
          },
          onDone: (result) => {
            const finalMsgs: ChatMessage[] = [
              { ...userMsg },
              {
                id: assistantId,
                role: 'assistant',
                content: result.content,
                ...(thinkingRef.current ? { thinking: thinkingRef.current } : {}),
                created_at: new Date().toISOString(),
              },
            ]
            onAppendMessages(finalMsgs)
          },
          onError: (err) => {
            setMessages((prev) =>
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
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[var(--color-border-secondary)] px-4 py-3">
        <div>
          <p className="text-xs font-semibold text-[var(--color-text-primary)]">Note Chat</p>
          <p className="text-[11px] text-[var(--color-text-tertiary)]">Context: this note</p>
        </div>
        {messages.length > 0 && (
          <span className="rounded-full bg-[#eff6ff] px-2 py-0.5 text-[10px] font-semibold text-[#1d4ed8]">
            {messages.length}
          </span>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {messages.length === 0 ? (
          <div className="py-8 text-center">
            <p className="text-xs font-medium text-[var(--color-text-secondary)]">Ask about this note</p>
            <p className="mt-1 text-[11px] text-[var(--color-text-tertiary)]">Summarise, extend, find gaps, or brainstorm based on its content.</p>
          </div>
        ) : (
          messages.map((m) => (
            <div key={m.id} className={`group flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              {m.role === 'assistant' && (
                <div className="mr-2 mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#0f172a] text-[10px] font-bold text-white">N</div>
              )}
              <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-xs leading-5 ${
                m.role === 'user'
                  ? 'bg-[#dbeafe] text-[var(--color-text-primary)]'
                  : 'bg-[var(--color-background-primary)] shadow-sm border border-[var(--color-border-secondary)] text-[var(--color-text-primary)]'
              }`}>
                {m.role === 'assistant' && m.content ? (
                  <div className="prose prose-xs max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      code({ className, children, ...props }: any) {
                        const match = /language-(\w+)/.exec(className ?? '')
                        if (!match) return <code className="rounded bg-black/[0.06] px-1 py-0.5 font-mono text-[11px]" {...props}>{children}</code>
                        return (
                          <SyntaxHighlighter language={match[1]} style={oneDark as Record<string, React.CSSProperties>} customStyle={{ borderRadius: '0.5rem', fontSize: '11px', margin: '0.5rem 0' }} PreTag="div">
                            {String(children).replace(/\n$/, '')}
                          </SyntaxHighlighter>
                        )
                      },
                    }}
                  >
                    {m.content}
                  </ReactMarkdown>
                  </div>
                ) : (
                  <p className="whitespace-pre-wrap">{m.content || (streaming && m.role === 'assistant' ? '…' : '')}</p>
                )}
              </div>
              {m.role === 'assistant' && m.content && (
                <button
                  onClick={() => void navigator.clipboard.writeText(m.content)}
                  className="ml-1 mt-1 self-start rounded p-1 text-[var(--color-text-tertiary)] opacity-0 transition-opacity hover:bg-[var(--color-background-secondary)] hover:text-[var(--color-text-primary)] group-hover:opacity-100"
                  title="Copy"
                >
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M4 2a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-1v1a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h1V2zm1 3H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-1H6a2 2 0 0 1-2-2V5zm6-4H6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h5v-2h2V2a1 1 0 0 0-1-1z"/></svg>
                </button>
              )}
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="border-t border-[var(--color-border-secondary)] p-3">
        <div className="flex items-end gap-2 rounded-xl border border-[#bfdbfe] bg-[var(--color-background-primary)] p-2 shadow-sm">
          <textarea
            className="min-h-[2.5rem] flex-1 resize-none bg-transparent text-xs leading-5 text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-tertiary)]"
            placeholder="Ask about this note…"
            value={input}
            disabled={streaming}
            onChange={(e) => setInput(e.target.value)}
            rows={2}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void send()
            }}
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

// ─── Notion page view ─────────────────────────────────────────────────────────

function NotionPageView({ page, token }: { page: NotionPage; token: string }) {
  const [content, setContent] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    setLoading(true)
    setContent(null)
    setError('')
    fetchNotionPageContent(token, page.id)
      .then((md) => setContent(md))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed to load page'))
      .finally(() => setLoading(false))
  }, [page.id, token])

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-8 py-6">
      <div className="mb-4 flex items-center gap-3">
        {page.icon && <span className="text-2xl">{page.icon}</span>}
        <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">{page.title}</h1>
        <a href={page.url} target="_blank" rel="noopener noreferrer"
          className="ml-auto shrink-0 rounded-lg border border-[var(--color-border-secondary)] px-2.5 py-1 text-xs text-[var(--color-text-secondary)] transition hover:border-[#000] hover:text-[var(--color-text-primary)]">
          Open in Notion ↗
        </a>
      </div>
      {loading && <p className="text-xs text-[var(--color-text-tertiary)]">Loading…</p>}
      {error && <p className="text-xs text-[#dc2626]">{error}</p>}
      {content !== null && (
        <div className="whitespace-pre-wrap text-sm leading-7 text-[var(--color-text-primary)]">
          {content || <span className="text-[var(--color-text-tertiary)]">Empty page</span>}
        </div>
      )}
    </div>
  )
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
      <div className="rounded-2xl border border-dashed border-[#bfdbfe] bg-[#eff6ff] p-10">
        <p className="text-sm font-semibold text-[var(--color-text-secondary)]">No note selected</p>
        <p className="mt-1 text-xs text-[var(--color-text-secondary)]">Select a note to edit it and chat about its content.</p>
        <button
          onClick={onCreate}
          className="mt-4 rounded-xl bg-[#1d4ed8] px-5 py-2 text-sm font-semibold text-white transition hover:bg-[#1e40af]"
        >
          New note
        </button>
      </div>
    </div>
  )
}

// ─── Main surface ─────────────────────────────────────────────────────────────

type ActiveView =
  | { kind: 'note'; id: string }
  | { kind: 'notion'; page: NotionPage }

export function NotesSurface() {
  const { hydrated, notes, createNote, updateNote, deleteNote, appendMessages, pinNote } = useNotes()
  const { store } = useConnectorAuth()
  const [activeView, setActiveView] = useState<ActiveView | null>(null)
  const [search, setSearch] = useState('')
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null)
  const [notionPages, setNotionPages] = useState<NotionPage[]>([])
  const [notionLoading, setNotionLoading] = useState(false)
  const [notionExpanded, setNotionExpanded] = useState(true)
  const [notionPushState, setNotionPushState] = useState<'idle' | 'pushing' | 'done' | 'error'>('idle')
  const [notionPushUrl, setNotionPushUrl] = useState<string | null>(null)

  const notionAuth = store.notion
  const notionToken = notionAuth?.status === 'connected' ? notionAuth.accessToken : null

  useEffect(() => {
    if (!notionToken) { setNotionPages([]); return }
    setNotionLoading(true)
    fetchNotionPages(notionToken)
      .then(setNotionPages)
      .catch(() => setNotionPages([]))
      .finally(() => setNotionLoading(false))
  }, [notionToken])

  const activeNoteId = activeView?.kind === 'note' ? activeView.id : null
  const activeNote = notes.find((n) => n.id === activeNoteId) ?? null

  const filtered = search.trim()
    ? notes.filter((n) =>
        n.title.toLowerCase().includes(search.toLowerCase()) ||
        n.body.toLowerCase().includes(search.toLowerCase()) ||
        n.tags.some((t) => t.toLowerCase().includes(search.toLowerCase()))
      )
    : notes

  function handleCreate() {
    const note = createNote()
    setActiveView({ kind: 'note', id: note.id })
  }

  function handleUpdate(patch: Partial<Note>) {
    if (!activeNoteId) return
    updateNote(activeNoteId, patch)
  }

  async function handlePushToNotion() {
    if (!activeNote || !notionToken) return
    setNotionPushState('pushing')
    setNotionPushUrl(null)
    try {
      const url = await createNotionPage(notionToken, activeNote.title || 'Untitled', activeNote.body)
      setNotionPushUrl(url)
      setNotionPushState('done')
    } catch {
      setNotionPushState('error')
    }
    setTimeout(() => setNotionPushState('idle'), 4000)
  }

  function handleDelete(id: string) {
    deleteNote(id)
    if (activeView?.kind === 'note' && activeView.id === id) setActiveView(null)
    setShowDeleteConfirm(null)
  }

  const handleAppendMessages = useCallback((msgs: ChatMessage[]) => {
    if (!activeNoteId) return
    appendMessages(activeNoteId, msgs)
  }, [activeNoteId, appendMessages])

  return (
    <div className="relative flex min-h-0 flex-1 overflow-hidden">
      {/* ── Sidebar ── */}
      <aside className="flex w-56 shrink-0 flex-col border-r border-[var(--color-border-secondary)] bg-[#eaf1f8]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--color-border-secondary)] px-3 py-3">
          <span className="text-xs font-semibold uppercase tracking-wide text-[#1d4ed8]">Notes</span>
          <button
            onClick={handleCreate}
            className="flex h-6 w-6 items-center justify-center rounded-lg text-[var(--color-text-secondary)] transition hover:bg-[var(--color-background-primary)] hover:text-[#1d4ed8]"
            title="New note"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
              <path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        {/* Search */}
        <div className="px-3 py-2">
          <input
            className="w-full rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-2.5 py-1.5 text-xs outline-none placeholder:text-[var(--color-text-tertiary)] focus:border-[#93c5fd]"
            placeholder="Search notes…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {/* Local notes list */}
        <div className="overflow-y-auto px-2 py-1 space-y-0.5" style={{ flex: notionToken ? '0 0 auto' : '1 1 auto', maxHeight: notionToken ? '45%' : undefined }}>
          {!hydrated && <p className="px-2 py-4 text-center text-xs text-[var(--color-text-tertiary)]">Loading…</p>}
          {hydrated && filtered.length === 0 && (
            <p className="px-2 py-4 text-center text-xs text-[var(--color-text-tertiary)]">
              {search ? 'No matches' : 'No notes yet'}
            </p>
          )}
          {filtered.map((note) => (
            <div key={note.id} className="group relative">
              <NoteListItem
                note={note}
                active={activeView?.kind === 'note' && activeView.id === note.id}
                onClick={() => setActiveView({ kind: 'note', id: note.id })}
              />
              {/* Hover actions */}
              <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition">
                <button
                  onClick={(e) => { e.stopPropagation(); pinNote(note.id, !note.pinned) }}
                  title={note.pinned ? 'Unpin' : 'Pin'}
                  className="flex h-5 w-5 items-center justify-center rounded text-[var(--color-text-tertiary)] hover:bg-[var(--color-background-primary)] hover:text-[#f59e0b]"
                >
                  <span className="text-[10px]">★</span>
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); setShowDeleteConfirm(note.id) }}
                  title="Delete"
                  className="flex h-5 w-5 items-center justify-center rounded text-[var(--color-text-tertiary)] hover:bg-[var(--color-background-primary)] hover:text-[#dc2626]"
                >
                  <svg width="9" height="9" viewBox="0 0 10 10" fill="none" aria-hidden>
                    <path d="M1 1l8 8M9 1L1 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                  </svg>
                </button>
              </div>

              {/* Delete confirm popover */}
              {showDeleteConfirm === note.id && (
                <div className="absolute left-0 right-0 z-10 top-full mt-1 mx-2 rounded-xl border border-[#fecaca] bg-[var(--color-background-primary)] p-3 shadow-lg">
                  <p className="text-xs font-medium text-[var(--color-text-primary)]">Delete this note?</p>
                  <p className="mt-0.5 text-[11px] text-[var(--color-text-secondary)]">This cannot be undone.</p>
                  <div className="mt-2 flex gap-2">
                    <button onClick={() => handleDelete(note.id)}
                      className="flex-1 rounded-lg bg-[#dc2626] py-1 text-xs font-semibold text-white hover:bg-[#b91c1c]">
                      Delete
                    </button>
                    <button onClick={() => setShowDeleteConfirm(null)}
                      className="flex-1 rounded-lg border border-[var(--color-border-secondary)] py-1 text-xs font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-background-secondary)]">
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Notion section */}
        {notionToken && (
          <div className="flex min-h-0 flex-1 flex-col border-t border-[var(--color-border-secondary)]">
            <button
              onClick={() => setNotionExpanded((v) => !v)}
              className="flex items-center gap-1.5 px-3 py-2 text-left"
            >
              <span className="text-[9px] text-[var(--color-text-tertiary)] transition-transform" style={{ display: 'inline-block', transform: notionExpanded ? 'rotate(90deg)' : 'none' }}>▶</span>
              <span className="flex h-4 w-4 items-center justify-center rounded bg-[#000] text-[8px] font-bold text-white">N</span>
              <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--color-text-tertiary)]">Notion</span>
              {notionLoading && <span className="ml-auto text-[10px] text-[var(--color-text-tertiary)]">…</span>}
              {!notionLoading && notionPages.length > 0 && (
                <span className="ml-auto text-[10px] text-[var(--color-text-tertiary)]">{notionPages.length}</span>
              )}
            </button>
            {notionExpanded && (
              <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-0.5">
                {notionPages.length === 0 && !notionLoading && (
                  <p className="px-2 py-2 text-center text-[11px] text-[var(--color-text-tertiary)]">No pages found</p>
                )}
                {notionPages.map((page) => {
                  const active = activeView?.kind === 'notion' && activeView.page.id === page.id
                  return (
                    <button
                      key={page.id}
                      onClick={() => setActiveView({ kind: 'notion', page })}
                      className={`flex w-full items-start gap-1.5 rounded-xl px-2.5 py-2 text-left transition ${active ? 'bg-[#f0fdf4]' : 'hover:bg-[var(--color-background-tertiary)]'}`}
                    >
                      <span className="mt-0.5 shrink-0 text-sm">{page.icon ?? '📄'}</span>
                      <div className="min-w-0">
                        <p className={`truncate text-xs font-medium ${active ? 'text-[#15803d]' : 'text-[var(--color-text-primary)]'}`}>{page.title}</p>
                        <p className="text-[10px] text-[#cbd5e1]">{timeAgo(page.lastEdited)}</p>
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* Footer count */}
        {hydrated && notes.length > 0 && !notionToken && (
          <div className="border-t border-[var(--color-border-secondary)] px-3 py-2 text-[10px] text-[var(--color-text-tertiary)]">
            {notes.length} note{notes.length !== 1 ? 's' : ''}
          </div>
        )}
      </aside>

      {/* ── Main area ── */}
      {activeView?.kind === 'note' && activeNote ? (
        <>
          <NoteEditor note={activeNote} onUpdate={handleUpdate} />
          {notionToken && (
            <div style={{ position: 'absolute', top: 12, right: 12, display: 'flex', alignItems: 'center', gap: 8, zIndex: 10 }}>
              {notionPushState === 'done' && notionPushUrl && (
                <a href={notionPushUrl} target="_blank" rel="noopener noreferrer"
                  style={{ fontSize: 11, color: '#6366f1', textDecoration: 'underline' }}>
                  Open in Notion ↗
                </a>
              )}
              {notionPushState === 'error' && (
                <span style={{ fontSize: 11, color: '#ef4444' }}>Push failed</span>
              )}
              <button
                onClick={() => void handlePushToNotion()}
                disabled={notionPushState === 'pushing'}
                style={{
                  background: notionPushState === 'done' ? '#f0fdf4' : 'var(--color-background-secondary)',
                  border: `1px solid ${notionPushState === 'done' ? '#bbf7d0' : 'var(--color-border-secondary)'}`,
                  borderRadius: 6, padding: '4px 10px', fontSize: 11, cursor: 'pointer',
                  color: notionPushState === 'done' ? '#16a34a' : 'var(--color-text-secondary)',
                  opacity: notionPushState === 'pushing' ? 0.6 : 1,
                }}
              >
                {notionPushState === 'pushing' ? 'Pushing…' : notionPushState === 'done' ? 'Pushed to Notion' : '↑ Push to Notion'}
              </button>
            </div>
          )}
          <NoteChat note={activeNote} onAppendMessages={handleAppendMessages} />
        </>
      ) : activeView?.kind === 'notion' && notionToken ? (
        <NotionPageView page={activeView.page} token={notionToken} />
      ) : (
        <EmptyState onCreate={handleCreate} />
      )}
    </div>
  )
}
