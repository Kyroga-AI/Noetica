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

function wordCount(text: string): number {
  const trimmed = text.trim()
  if (!trimmed) return 0
  return trimmed.split(/\s+/).length
}

// Hardcoded Notion pages for the prototype FROM NOTION section
const DUMMY_NOTION_PAGES = [
  { id: 'dummy-1', title: 'Q3 Pricing Revi…', lastEdited: '2d ago' },
  { id: 'dummy-2', title: 'Competitor An…', lastEdited: '5d ago' },
  { id: 'dummy-3', title: 'Product Road…', lastEdited: '1w ago' },
]

// ─── Note list item ──────────────────────────────────────────────────────────

function NoteListItem({
  note,
  active,
  onClick,
  onPin,
  onDelete,
  confirmDelete,
}: {
  note: Note
  active: boolean
  onClick: () => void
  onPin: () => void
  onDelete: () => void
  confirmDelete: boolean
}) {
  if (active) {
    return (
      <div style={{ padding: '9px 10px', borderRadius: 8, background: 'var(--accent)', marginBottom: 3, cursor: 'default' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }}>
          {note.pinned && <span style={{ fontSize: 9, opacity: 0.8 }}>📌</span>}
          <div style={{ fontSize: 12, fontWeight: 700, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1 }}>
            {note.title || 'Untitled'}
          </div>
        </div>
        {note.tags.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginBottom: 5 }}>
            {note.tags.map((tag) => (
              <div key={tag} style={{ padding: '1px 6px', borderRadius: 20, background: 'rgba(255,255,255,0.2)', fontSize: 10, color: '#fff' }}>{tag}</div>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.55)' }}>{timeAgo(note.updatedAt)}</span>
          <div style={{ display: 'flex', gap: 3 }}>
            <button onClick={(e) => { e.stopPropagation(); onPin() }} style={{ padding: '2px 5px', borderRadius: 4, fontSize: 10, cursor: 'pointer', color: 'rgba(255,255,255,0.75)', background: 'transparent', border: 'none' }}>📌</button>
            {confirmDelete ? (
              <button onClick={(e) => { e.stopPropagation(); onDelete() }} style={{ padding: '2px 7px', borderRadius: 4, fontSize: 10, fontWeight: 700, color: '#fff', background: 'oklch(50% 0.2 20)', cursor: 'pointer', border: 'none' }}>Delete?</button>
            ) : (
              <button onClick={(e) => { e.stopPropagation(); onDelete() }} style={{ padding: '2px 5px', borderRadius: 4, fontSize: 10, cursor: 'pointer', color: 'rgba(255,255,255,0.75)', background: 'transparent', border: 'none' }}>🗑</button>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      onClick={onClick}
      style={{ padding: '9px 10px', borderRadius: 8, marginBottom: 3, cursor: 'pointer' }}
      className="hover:bg-[var(--paper-sunk-2)]"
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }}>
        {note.pinned && <span style={{ fontSize: 9, opacity: 0.6 }}>📌</span>}
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1 }}>
          {note.title || 'Untitled'}
        </div>
      </div>
      {note.tags.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginBottom: 5 }}>
          {note.tags.map((tag) => (
            <div key={tag} style={{ padding: '1px 6px', borderRadius: 20, border: '1px solid var(--line-soft)', fontSize: 10, color: 'var(--ink3)' }}>{tag}</div>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 10, color: 'var(--ink3)' }}>{timeAgo(note.updatedAt)}</span>
        <div style={{ display: 'flex', gap: 3 }}>
          <button onClick={(e) => { e.stopPropagation(); onPin() }} className="hover:bg-[var(--line)]" style={{ padding: '2px 5px', borderRadius: 4, fontSize: 10, cursor: 'pointer', color: 'var(--ink3)', background: 'transparent', border: 'none' }}>📌</button>
          {confirmDelete ? (
            <button onClick={(e) => { e.stopPropagation(); onDelete() }} style={{ padding: '2px 7px', borderRadius: 4, fontSize: 10, fontWeight: 700, color: '#fff', background: 'oklch(50% 0.2 20)', cursor: 'pointer', border: 'none' }}>Delete?</button>
          ) : (
            <button onClick={(e) => { e.stopPropagation(); onDelete() }} className="hover:bg-[var(--line)]" style={{ padding: '2px 5px', borderRadius: 4, fontSize: 10, cursor: 'pointer', color: 'var(--ink3)', background: 'transparent', border: 'none' }}>🗑</button>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Note editor ──────────────────────────────────────────────────────────────

function NoteEditor({ note, onUpdate }: { note: Note; onUpdate: (patch: Partial<Note>) => void }) {
  const [preview, setPreview] = useState(false)
  const [tagInput, setTagInput] = useState('')
  const [linkSuggestions, setLinkSuggestions] = useState<LinkSuggestion[]>([])
  const [indexStatus, setIndexStatus] = useState<'idle' | 'indexing' | 'indexed' | 'failed'>('idle')
  const [indexedSnapshot, setIndexedSnapshot] = useState<string | null>(null)
  const [indexedAt, setIndexedAt] = useState<number | null>(null)
  const [, setElapsedTick] = useState(0)
  const isStale = indexStatus === 'indexed' && indexedSnapshot !== null && indexedSnapshot !== note.body
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const suggestTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const el = bodyRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [note.body])

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
        .catch(() => { /* embedder unavailable */ })
    }, 800)
    return () => { if (suggestTimerRef.current) clearTimeout(suggestTimerRef.current) }
  }, [note.body])

  useEffect(() => {
    if (indexStatus !== 'indexed' || indexedAt === null) return
    const id = setInterval(() => setElapsedTick((t) => t + 1), 30_000)
    return () => clearInterval(id)
  }, [indexStatus, indexedAt])

  function insertLink(label: string) {
    const el = bodyRef.current
    const insertion = `[[${label}]]`
    if (el) {
      const pos = el.selectionStart
      onUpdate({ body: note.body.slice(0, pos) + insertion + note.body.slice(pos) })
      setTimeout(() => { el.focus(); el.setSelectionRange(pos + insertion.length, pos + insertion.length) }, 0)
    } else {
      onUpdate({ body: note.body ? `${note.body} ${insertion}` : insertion })
    }
    setLinkSuggestions((prev) => prev.filter((s) => s.label !== label))
  }

  async function syncToGraph() {
    if (indexStatus === 'indexing') return
    const snapshot = note.body
    setIndexStatus('indexing')
    try {
      const markdown = `# ${note.title}\n\n${note.body}`
      const arr = new TextEncoder().encode(markdown)
      let bin = ''
      for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]!)
      const res = await fetch(amUrl('/api/ingest/queue'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          filename: `notes/${note.id}.md`,
          mimeType: 'text/markdown',
          dataBase64: btoa(bin),
        }),
        signal: AbortSignal.timeout(8000),
      })
      if (!res.ok) throw new Error(`ingest queue returned ${res.status}`)
      setIndexStatus('indexed')
      setIndexedSnapshot(snapshot)
      setIndexedAt(Date.now())
    } catch {
      setIndexStatus('failed')
    }
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

  // Index button styling per 5-state spec
  const indexBorder = indexStatus === 'failed' ? 'var(--danger)'
    : isStale ? 'var(--pending-line)'
    : indexStatus === 'indexed' ? 'var(--verified-line)'
    : 'var(--line)'
  const indexBg = indexStatus === 'failed' ? 'transparent'
    : isStale ? 'var(--pending-soft)'
    : indexStatus === 'indexed' ? 'var(--verified-soft)'
    : 'transparent'
  const indexFg = indexStatus === 'failed' ? 'var(--danger-fg)'
    : isStale ? 'var(--pending-fg)'
    : indexStatus === 'indexed' ? 'var(--verified-fg)'
    : 'var(--ink2)'
  const indexLabel = indexStatus === 'indexing' ? 'Indexing…'
    : indexStatus === 'failed' ? 'Failed'
    : isStale ? 'Re-index'
    : indexStatus === 'indexed' ? `✓ Indexed${indexedAt !== null ? ' ' + timeAgo(new Date(indexedAt).toISOString()) : ''}`
    : 'Index'

  function handleDownload() {
    const slug = note.title.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'note'
    const blob = new Blob([`# ${note.title}\n\n${note.body}`], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = `${slug}.md`; a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', background: 'var(--paper)' }}>
      {/* Top toolbar */}
      <div style={{ padding: '10px 16px 8px', borderBottom: '1px solid var(--line-soft)', display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            value={note.title}
            onChange={(e) => onUpdate({ title: e.target.value })}
            placeholder="Untitled note"
            style={{ flex: 1, border: 'none', background: 'transparent', fontSize: 17, fontWeight: 700, color: 'var(--ink)', outline: 'none', fontFamily: 'inherit', minWidth: 0 }}
          />
          <span style={{ fontSize: 11, color: 'var(--ink3)', flexShrink: 0 }}>{wordCount(note.body)} words</span>
          {/* Index button */}
          <button
            onClick={() => void syncToGraph()}
            disabled={indexStatus === 'indexing' || !note.body.trim()}
            style={{ padding: '4px 11px', borderRadius: 7, border: `1px solid ${indexBorder}`, background: indexBg, color: indexFg, fontSize: 11.5, fontWeight: 700, cursor: 'pointer', flexShrink: 0, whiteSpace: 'nowrap', opacity: indexStatus === 'indexing' ? 0.6 : 1 }}
          >
            {indexLabel}
          </button>
          {/* Download */}
          <button
            onClick={handleDownload}
            title="Download .md"
            className="hover:bg-[var(--paper-sunk)]"
            style={{ width: 28, height: 28, borderRadius: 7, border: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--ink2)', flexShrink: 0, background: 'transparent' }}
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M8 2v8M5 7l3 3 3-3M3 12h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
          {/* Edit/Preview toggle */}
          <div style={{ display: 'flex', border: '1px solid var(--line)', borderRadius: 7, overflow: 'hidden', flexShrink: 0 }}>
            <button
              onClick={() => setPreview(false)}
              style={{ padding: '4px 10px', fontSize: 11.5, fontWeight: 600, cursor: 'pointer', background: !preview ? 'var(--paper-sunk)' : 'transparent', color: !preview ? 'var(--ink)' : 'var(--ink3)', border: 'none' }}
            >
              Edit
            </button>
            <button
              onClick={() => setPreview(true)}
              style={{ padding: '4px 10px', fontSize: 11.5, fontWeight: 600, cursor: 'pointer', background: preview ? 'var(--paper-sunk)' : 'transparent', color: preview ? 'var(--ink)' : 'var(--ink3)', border: 'none' }}
            >
              Preview
            </button>
          </div>
        </div>
        {/* Tags row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap', minHeight: 24 }}>
          {note.tags.map((tag) => (
            <div key={tag} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '2px 7px 2px 9px', borderRadius: 20, background: 'var(--paper-sunk)', border: '1px solid var(--line)', fontSize: 11.5, color: 'var(--ink2)' }}>
              <span>{tag}</span>
              <button
                onClick={() => removeTag(tag)}
                className="hover:bg-[var(--line)]"
                style={{ cursor: 'pointer', width: 14, height: 14, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, lineHeight: 1, color: 'var(--ink3)', background: 'transparent', border: 'none', padding: 0 }}
              >
                &times;
              </button>
            </div>
          ))}
          <input
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={addTag}
            placeholder={note.tags.length === 0 ? 'Add tags…' : '+'}
            style={{ border: 'none', outline: 'none', background: 'transparent', fontSize: 11.5, color: 'var(--ink)', minWidth: 90, flex: 1 }}
          />
        </div>
        {/* Link suggestions */}
        {linkSuggestions.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 10.5, color: 'var(--ink3)', flexShrink: 0 }}>Related in graph:</span>
            {linkSuggestions.map((sug) => (
              <button
                key={sug.id}
                onClick={() => insertLink(sug.label)}
                className="hover:bg-[var(--paper-sunk-2)]"
                style={{ padding: '2px 9px', borderRadius: 20, border: '1px solid var(--line)', fontSize: 11, color: 'var(--ink2)', cursor: 'pointer', background: 'var(--paper-sunk)' }}
              >
                {sug.label} <span style={{ color: 'var(--ink3)', fontSize: 10 }}>{(sug.sim * 100).toFixed(0)}%</span>
              </button>
            ))}
          </div>
        )}
        {/* Format toolbar (edit mode) */}
        {!preview && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
            <button className="hover:bg-[var(--paper-sunk-2)]" style={{ padding: '3px 9px', borderRadius: 5, border: '1px solid var(--line)', fontSize: 12, fontWeight: 700, color: 'var(--ink2)', cursor: 'pointer', background: 'var(--paper-sunk)' }}>B</button>
            <button className="hover:bg-[var(--paper-sunk-2)]" style={{ padding: '3px 9px', borderRadius: 5, border: '1px solid var(--line)', fontSize: 12, fontStyle: 'italic', color: 'var(--ink2)', cursor: 'pointer', background: 'var(--paper-sunk)' }}>I</button>
            <div style={{ width: 1, height: 14, background: 'var(--line)', margin: '0 2px' }} />
            <button className="hover:bg-[var(--paper-sunk-2)]" style={{ padding: '3px 8px', borderRadius: 5, border: '1px solid var(--line)', fontSize: 11, fontWeight: 700, color: 'var(--ink2)', cursor: 'pointer', background: 'var(--paper-sunk)' }}>H1</button>
            <button className="hover:bg-[var(--paper-sunk-2)]" style={{ padding: '3px 8px', borderRadius: 5, border: '1px solid var(--line)', fontSize: 11, fontWeight: 700, color: 'var(--ink2)', cursor: 'pointer', background: 'var(--paper-sunk)' }}>H2</button>
            <div style={{ width: 1, height: 14, background: 'var(--line)', margin: '0 2px' }} />
            <button className="hover:bg-[var(--paper-sunk-2)]" style={{ padding: '3px 9px', borderRadius: 5, border: '1px solid var(--line)', fontSize: 13, color: 'var(--ink2)', cursor: 'pointer', background: 'var(--paper-sunk)' }}>{'≡'}</button>
            <button className="hover:bg-[var(--paper-sunk-2)]" style={{ padding: '3px 9px', borderRadius: 5, border: '1px solid var(--line)', fontSize: 13, color: 'var(--ink2)', cursor: 'pointer', background: 'var(--paper-sunk)' }}>{'“'}</button>
            <button className="hover:bg-[var(--paper-sunk-2)]" style={{ padding: '3px 8px', borderRadius: 5, border: '1px solid var(--line)', fontSize: 11, fontFamily: 'monospace', color: 'var(--ink2)', cursor: 'pointer', background: 'var(--paper-sunk)' }}>&lt;/&gt;</button>
          </div>
        )}
      </div>
      {/* Editor body */}
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {!preview ? (
          <textarea
            ref={bodyRef}
            data-note-editor=""
            value={note.body}
            onChange={(e) => onUpdate({ body: e.target.value })}
            placeholder="Start writing…"
            style={{ width: '100%', height: '100%', minHeight: 400, boxSizing: 'border-box', border: 'none', resize: 'none', outline: 'none', padding: '28px 40px', fontSize: 14, lineHeight: 1.85, color: 'var(--ink)', background: 'var(--paper)', fontFamily: "'IBM Plex Mono','Fira Mono',monospace" }}
          />
        ) : (
          <div style={{ padding: '28px 40px', fontSize: 14, lineHeight: 1.85, color: 'var(--ink)' }}>
            {note.body ? (
              <div className="prose prose-sm max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{note.body}</ReactMarkdown>
              </div>
            ) : (
              <span style={{ color: 'var(--ink3)' }}>Nothing to preview.</span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Note chat ────────────────────────────────────────────────────────────────

function NoteChat({ note, onAppendMessages, onPushToNotion, notionPushState, notionPushUrl, hasNotion }: {
  note: Note | null
  onAppendMessages: (msgs: ChatMessage[]) => void
  onPushToNotion: () => void
  notionPushState: 'idle' | 'pushing' | 'done' | 'error'
  notionPushUrl: string | null
  hasNotion: boolean
}) {
  const { settings } = useSettings()
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>(note?.messages ?? [])
  const thinkingRef = useRef<string>('')
  const bottomRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => () => { abortRef.current?.abort() }, [])
  useEffect(() => { setMessages(note?.messages ?? []) }, [note?.id])
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  async function send() {
    if (!note) return
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
      google:      settings.googleApiKey       || undefined,
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
          onThinkingDone: (thinking) => { thinkingRef.current = thinking },
          onDelta: (delta) => {
            setMessages((prev) =>
              prev.map((m) => m.id === assistantId ? { ...m, content: m.content + delta } : m)
            )
          },
          onDone: (result) => {
            const finalMsgs: ChatMessage[] = [
              { ...userMsg },
              {
                id: assistantId, role: 'assistant', content: result.content,
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

  // Push to Notion label
  const notionLabel = notionPushState === 'pushing' ? 'Pushing…'
    : notionPushState === 'done' ? '✓ Pushed to Notion'
    : notionPushState === 'error' ? 'Push failed'
    : '↑ Push to Notion'
  const notionFg = notionPushState === 'done' ? '#16a34a'
    : notionPushState === 'error' ? '#ef4444'
    : 'var(--ink2)'

  return (
    <div style={{ width: 240, flexShrink: 0, borderLeft: '1px solid var(--line)', display: 'flex', flexDirection: 'column', background: 'var(--paper-sunk)' }}>
      {/* Header */}
      <div style={{ padding: '11px 14px', borderBottom: '1px solid var(--line-soft)', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <div style={{ width: 22, height: 22, borderRadius: 6, background: 'var(--ink2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M2 3h8M2 6h6M2 9h4" stroke="#fff" strokeWidth="1.5" strokeLinecap="round"/></svg>
        </div>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>Note Chat</div>
        <div style={{ marginLeft: 'auto', padding: '2px 7px', borderRadius: 20, border: '1px solid var(--line-soft)', background: 'var(--paper-sunk-2)', fontSize: 10, fontWeight: 600, color: 'var(--ink3)' }}>AI can&apos;t edit your note</div>
      </div>

      {/* Messages */}
      <div data-note-chat-scroll="" style={{ flex: 1, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 9, minHeight: 0 }}>
        {!note ? (
          /* No note selected */
          <div style={{ padding: '18px 8px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink2)' }}>Select a note to chat</div>
          </div>
        ) : messages.length === 0 ? (
          /* Empty state with suggestions */
          <div style={{ padding: '18px 8px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink2)' }}>Ask about this note</div>
            <div style={{ fontSize: 11.5, color: 'var(--ink3)', lineHeight: 1.6, textAlign: 'center' }}>
              &ldquo;Summarise this&rdquo;<br/>
              &ldquo;What am I missing?&rdquo;<br/>
              &ldquo;Critique the structure&rdquo;
            </div>
            <div style={{ marginTop: 4, padding: '4px 10px', borderRadius: 20, background: 'var(--paper-sunk-2)', border: '1px solid var(--line)', fontSize: 10.5, color: 'var(--ink3)' }}>AI cannot edit this note</div>
          </div>
        ) : (
          /* Messages */
          <>
            {messages.map((m) => (
              m.role === 'user' ? (
                <div key={m.id} style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <div style={{ maxWidth: 200, padding: '8px 11px', borderRadius: '14px 14px 3px 14px', background: 'var(--ink)', color: 'var(--paper)', fontSize: 12.5, lineHeight: 1.5 }}>
                    <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{m.content}</p>
                  </div>
                </div>
              ) : m.role === 'assistant' ? (
                <div key={m.id} style={{ maxWidth: 220, padding: '8px 11px', borderRadius: '14px 14px 14px 3px', background: 'var(--paper)', border: '1px solid var(--line-soft)', color: 'var(--ink)', fontSize: 12.5, lineHeight: 1.55 }}>
                  {m.content ? (
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
                  ) : streaming ? (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                      <span className="animate-pulse" style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--ink3)' }} />
                      <span className="animate-pulse" style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--ink3)', animationDelay: '0.2s' }} />
                      <span className="animate-pulse" style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--ink3)', animationDelay: '0.4s' }} />
                      <span style={{ fontSize: 11.5, color: 'var(--ink2)', marginLeft: 4 }}>Thinking…</span>
                    </span>
                  ) : null}
                </div>
              ) : null
            ))}
          </>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div style={{ borderTop: '1px solid var(--line-soft)', padding: 10, flexShrink: 0 }}>
        {note ? (
          <div style={{ border: '1px solid var(--line)', borderRadius: 10, background: 'var(--paper)', overflow: 'hidden' }}>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void send() }}
              placeholder="Ask about the note…"
              rows={3}
              disabled={streaming}
              style={{ width: '100%', boxSizing: 'border-box', border: 'none', resize: 'none', outline: 'none', padding: '9px 11px', fontSize: 12.5, lineHeight: 1.5, color: 'var(--ink)', background: 'transparent', fontFamily: 'inherit' }}
            />
            <div style={{ padding: '6px 8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid var(--line-soft)' }}>
              <span style={{ fontSize: 10.5, color: 'var(--ink3)' }}>{'⌘↵'} to send</span>
              {streaming ? (
                <button onClick={stop} style={{ padding: '5px 13px', borderRadius: 7, background: '#ef4444', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer', border: 'none' }}>Stop</button>
              ) : (
                <button
                  onClick={() => void send()}
                  disabled={!input.trim()}
                  className="hover:opacity-75"
                  style={{ padding: '5px 13px', borderRadius: 7, background: 'var(--ink)', color: 'var(--paper)', fontSize: 12, fontWeight: 700, cursor: 'pointer', border: 'none', opacity: !input.trim() ? 0.4 : 1 }}
                >
                  Ask
                </button>
              )}
            </div>
          </div>
        ) : null}
      </div>

      {/* Push to Notion */}
      <div style={{ borderTop: '1px solid var(--line-soft)', padding: 10, flexShrink: 0 }}>
        <button
          onClick={onPushToNotion}
          disabled={!note || notionPushState === 'pushing'}
          className="hover:bg-[var(--paper-sunk)]"
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: 7, borderRadius: 8, border: '1px solid var(--line)', cursor: note ? 'pointer' : 'default', background: 'var(--paper)', width: '100%', opacity: !note ? 0.5 : 1 }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="18" height="18" rx="3" stroke="currentColor" strokeWidth="2"/><path d="M8 8h8M8 12h5" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
          <span style={{ fontSize: 12, fontWeight: 600, color: notionFg }}>{notionLabel}</span>
        </button>
        {notionPushState === 'done' && notionPushUrl && (
          <a href={notionPushUrl} target="_blank" rel="noopener noreferrer"
            style={{ display: 'block', textAlign: 'center', marginTop: 4, fontSize: 10, color: 'var(--ink3)', textDecoration: 'underline' }}>
            Open in Notion
          </a>
        )}
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
    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflowY: 'auto', padding: '24px 32px', background: 'var(--paper)' }}>
      <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
        {page.icon && <span style={{ fontSize: 24 }}>{page.icon}</span>}
        <h1 style={{ fontSize: 24, fontWeight: 700, color: 'var(--ink)', margin: 0 }}>{page.title}</h1>
        <a href={page.url} target="_blank" rel="noopener noreferrer"
          style={{ marginLeft: 'auto', flexShrink: 0, borderRadius: 8, border: '1px solid var(--line)', padding: '4px 10px', fontSize: 12, color: 'var(--ink2)', textDecoration: 'none' }}>
          Open in Notion &#8599;
        </a>
      </div>
      {loading && <p style={{ fontSize: 12, color: 'var(--ink3)' }}>Loading…</p>}
      {error && <p style={{ fontSize: 12, color: '#dc2626' }}>{error}</p>}
      {content !== null && (
        <div style={{ whiteSpace: 'pre-wrap', fontSize: 14, lineHeight: 1.85, color: 'var(--ink)' }}>
          {content || <span style={{ color: 'var(--ink3)' }}>Empty page</span>}
        </div>
      )}
    </div>
  )
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40, background: 'var(--paper)' }}>
      <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
        <div style={{ width: 44, height: 44, borderRadius: 10, border: '2px dashed var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, color: 'var(--ink3)' }}>{'✎'}</div>
        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)' }}>No note selected</div>
        <button
          onClick={onCreate}
          style={{ marginTop: 4, padding: '9px 20px', borderRadius: 9, background: 'var(--accent)', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', border: 'none' }}
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
    if (showDeleteConfirm === id) {
      deleteNote(id)
      if (activeView?.kind === 'note' && activeView.id === id) setActiveView(null)
      setShowDeleteConfirm(null)
    } else {
      setShowDeleteConfirm(id)
      // Auto-dismiss after 3s
      setTimeout(() => setShowDeleteConfirm((cur) => cur === id ? null : cur), 3000)
    }
  }

  const handleAppendMessages = useCallback((msgs: ChatMessage[]) => {
    if (!activeNoteId) return
    appendMessages(activeNoteId, msgs)
  }, [activeNoteId, appendMessages])

  // FROM NOTION entries: use real pages if available, else hardcoded dummy pages
  const fromNotionEntries = notionPages.length > 0
    ? notionPages.slice(0, 5).map((p) => ({ id: p.id, title: p.title, lastEdited: timeAgo(p.lastEdited) }))
    : DUMMY_NOTION_PAGES

  return (
    <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>
      {/* ── LEFT: Note list + Notion pages ── */}
      <div style={{ width: 168, flexShrink: 0, borderRight: '1px solid var(--line)', display: 'flex', flexDirection: 'column', background: 'var(--paper-sunk)' }}>
        {/* Top section: description + header + search */}
        <div style={{ padding: '13px 12px 9px', borderBottom: '1px solid var(--line-soft)' }}>
          {/* Description banner */}
          <div style={{ padding: '10px 12px 12px', margin: '-13px -12px 10px', background: 'var(--paper-sunk-2)', borderBottom: '1px solid var(--line-soft)' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink)', marginBottom: 4 }}>Notes</div>
            <div style={{ fontSize: 11, lineHeight: 1.55, color: 'var(--ink3)' }}>You write, the AI advises &mdash; it can read and comment on your notes but cannot edit them. Tag, backlink, and Index when you&apos;re ready to share with your knowledge brain.</div>
          </div>
          {/* Notes header + new button */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 9 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)', letterSpacing: '-0.01em' }}>Notes</div>
            <button
              onClick={handleCreate}
              title="New note"
              className="hover:bg-[var(--paper-sunk-2)]"
              style={{ width: 22, height: 22, borderRadius: 5, border: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: 16, lineHeight: 1, color: 'var(--ink2)', background: 'var(--paper)', padding: 0 }}
            >
              +
            </button>
          </div>
          {/* Search */}
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search notes…"
            style={{ width: '100%', boxSizing: 'border-box', border: '1px solid var(--line)', background: 'var(--paper)', borderRadius: 7, padding: '5px 9px', fontSize: 11.5, color: 'var(--ink)', outline: 'none' }}
          />
        </div>

        {/* Note list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '6px 5px', minHeight: 0 }}>
          {hydrated && filtered.length === 0 && (
            <div style={{ padding: '20px 12px', textAlign: 'center', fontSize: 12, color: 'var(--ink3)', lineHeight: 1.6 }}>
              {search ? 'No matches' : <>No notes yet.<br/>Click + to start.</>}
            </div>
          )}
          {!hydrated && (
            <div style={{ padding: '20px 12px', textAlign: 'center', fontSize: 12, color: 'var(--ink3)' }}>Loading…</div>
          )}
          {filtered.map((note) => (
            <NoteListItem
              key={note.id}
              note={note}
              active={activeView?.kind === 'note' && activeView.id === note.id}
              onClick={() => setActiveView({ kind: 'note', id: note.id })}
              onPin={() => pinNote(note.id, !note.pinned)}
              onDelete={() => handleDelete(note.id)}
              confirmDelete={showDeleteConfirm === note.id}
            />
          ))}
        </div>

        {/* FROM NOTION section */}
        <div style={{ borderTop: '1px solid var(--line-soft)', padding: '8px 10px 10px', flexShrink: 0 }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.5, color: 'var(--ink3)', textTransform: 'uppercase', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 5 }}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="18" height="18" rx="3" stroke="currentColor" strokeWidth="2"/><path d="M8 8h8M8 12h5" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
            From Notion
            {notionLoading && <span style={{ marginLeft: 'auto' }}>…</span>}
          </div>
          {fromNotionEntries.map((page) => (
            <div
              key={page.id}
              className="hover:bg-[var(--paper-sunk-2)]"
              style={{ padding: '5px 7px', borderRadius: 6, cursor: 'default', display: 'flex', alignItems: 'center', gap: 5, marginBottom: 2 }}
            >
              <div style={{ width: 5, height: 5, borderRadius: 1, background: 'var(--ink3)', flexShrink: 0 }} />
              <div style={{ fontSize: 11.5, color: 'var(--ink2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1 }}>{page.title}</div>
              <div style={{ fontSize: 10, color: 'var(--ink3)', flexShrink: 0 }}>{page.lastEdited}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── CENTER: Note editor ── */}
      {activeView?.kind === 'note' && activeNote ? (
        <NoteEditor key={activeNote.id} note={activeNote} onUpdate={handleUpdate} />
      ) : activeView?.kind === 'notion' && notionToken ? (
        <NotionPageView page={activeView.page} token={notionToken} />
      ) : (
        <EmptyState onCreate={handleCreate} />
      )}

      {/* ── RIGHT: Note Chat (always visible) ── */}
      <NoteChat
        note={activeNote}
        onAppendMessages={handleAppendMessages}
        onPushToNotion={() => void handlePushToNotion()}
        notionPushState={notionPushState}
        notionPushUrl={notionPushUrl}
        hasNotion={!!notionToken}
      />
    </div>
  )
}
