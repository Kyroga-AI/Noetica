'use client'

import React, { useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { PlanChecklist } from '@/components/chat/PlanChecklist'
import remarkGfm from 'remark-gfm'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
// eslint-disable-next-line
import oneLight from 'react-syntax-highlighter/dist/cjs/styles/prism/one-light'
// eslint-disable-next-line
import oneDark from 'react-syntax-highlighter/dist/cjs/styles/prism/one-dark'
import { BuildCard } from '@/components/chat/BuildCard'
import { ChartView } from '@/components/chat/ChartView'
import { GenUIBlock, hasGenUI, splitGenUI } from '@/components/chat/GenUIRenderer'
import type { ChatMessage, ToolCallRecord, ToolResultRecord, CriticVerdict } from '@/lib/types/message'
import type { PendingAttachment } from '@/lib/types/attachment'
import { useSettings } from '@/lib/settings/context'
import { useRevealedContent, APP_OPEN_TS } from '@/lib/chat/useRevealedContent'
import { cleanSources } from '@/lib/chat/sources'
import { providerTier, TIER_META } from '@/lib/chat/sovereignty'
import { amUrl } from '@/lib/tauri/bridge'

// A single quiet file glyph (SVG, not emoji) for attachment chips.
function FileGlyph({ className = '' }: { className?: string }) {
  return (
    <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden className={className}>
      <path d="M3.5 1.5h4L11 5v7.5H3.5V1.5z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
      <path d="M7.5 1.5V5H11" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
    </svg>
  )
}

function AttachmentList({ attachments }: { attachments: PendingAttachment[] }) {
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {attachments.map((a) => (
        <div key={a.clientId} className="flex items-center gap-1.5 rounded-xl border border-[#93c5fd] bg-[#eff6ff] px-2.5 py-1.5 text-xs">
          {a.kind === 'image' ? (
            <img src={`data:${a.mimeType};base64,${a.base64}`} alt={a.name} className="h-8 w-8 rounded-lg object-cover" />
          ) : (
            <span className="text-[var(--color-text-tertiary)]"><FileGlyph /></span>
          )}
          <span className="max-w-[120px] truncate font-medium text-[var(--color-text-primary)]">{a.name}</span>
          <span className="text-[var(--color-text-secondary)]">{a.sizeLabel}</span>
        </div>
      ))}
    </div>
  )
}

// Dispatched sub-agents get their own recognizable card (role badge + task + result), so a
// delegation reads as "the concierge handed this to a specialist", not a generic tool call.
const DISPATCH_ROLE_META: Record<string, { color: string }> = {
  researcher: { color: '#0ea5e9' },
  coder:      { color: '#8b5cf6' },
  reviewer:   { color: '#f59e0b' },
  analyst:    { color: '#10b981' },
  planner:    { color: '#6366f1' },
  general:    { color: '#64748b' },
}
function DispatchCard({ call, result }: { call: ToolCallRecord; result?: ToolResultRecord }) {
  const [open, setOpen] = useState(false)
  const input = (call.input ?? {}) as { role?: string; task?: string }
  const role = String(input.role ?? 'general')
  const task = String(input.task ?? '')
  const meta = DISPATCH_ROLE_META[role] ?? DISPATCH_ROLE_META.general!
  const running = !result
  const body = (result?.result ?? '').replace(/^\[[^\]]*sub-agent[^\]]*\]\s*/i, '')
  return (
    <div className="my-1.5 overflow-hidden rounded-xl border" style={{ borderColor: `${meta.color}55` }}>
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 px-3 py-2 text-left transition hover:bg-[var(--color-background-secondary)]">
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${running ? 'animate-pulse' : ''}`} style={{ background: running ? '#fbbf24' : meta.color }} />
        <span className="shrink-0 text-[11px] font-semibold capitalize" style={{ color: meta.color }}>Dispatched {role}</span>
        <span className="min-w-0 flex-1 truncate text-[11px] text-[var(--color-text-tertiary)]">{task}</span>
        <span className="shrink-0 text-[11px] text-[var(--color-text-tertiary)]">{running ? 'running…' : (open ? '▲' : '▼')}</span>
      </button>
      {open && (
        <div className="border-t border-[var(--color-border-tertiary)] bg-[var(--color-background-secondary)] px-3 py-2">
          <div className="mb-1 text-[11px] font-semibold text-[var(--color-text-tertiary)]">Task</div>
          <p className="mb-2 whitespace-pre-wrap text-[12px] text-[var(--color-text-secondary)]">{task}</p>
          {result && (
            <>
              <div className="mb-1 text-[11px] font-semibold text-[var(--color-text-tertiary)]">Result</div>
              <MarkdownContent content={body} compact />
            </>
          )}
        </div>
      )}
    </div>
  )
}

function ToolCallCard({ call, result }: { call: ToolCallRecord; result?: ToolResultRecord }) {
  const [open, setOpen] = useState(false)
  const inputStr = JSON.stringify(call.input, null, 2)
  const isError = result?.result.startsWith('Error:')
  if (call.name === 'dispatch_agent') return <DispatchCard call={call} result={result} />

  return (
    <div className="my-1.5 overflow-hidden rounded-xl border border-[var(--color-border-secondary)]">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition hover:bg-[var(--color-background-secondary)]"
      >
        {/* status dot */}
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${
          !result ? 'bg-[#fbbf24] animate-pulse' :
          isError ? 'bg-[#ef4444]' : 'bg-[var(--color-accent)]'
        }`} />
        {/* tool icon */}
        <svg width="11" height="11" viewBox="0 0 14 14" fill="none" aria-hidden className="shrink-0 text-[var(--color-text-tertiary)]">
          <path d="M2 7h10M7 2v10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
          <rect x="1" y="1" width="12" height="12" rx="3" stroke="currentColor" strokeWidth="1.2"/>
        </svg>
        <span className="flex-1 font-mono text-[11px] font-semibold text-[var(--color-text-primary)]">{call.name}</span>
        <span className="text-[11px] text-[var(--color-text-tertiary)]">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="border-t border-[var(--color-border-tertiary)] bg-[var(--color-background-secondary)]">
          {/* Input */}
          <div className="px-3 py-2">
            <div className="mb-1 text-[11px] font-semibold text-[var(--color-text-tertiary)]">Input</div>
            <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-5 text-[var(--color-text-secondary)]">{inputStr}</pre>
          </div>
          {/* Result */}
          {result && (
            <div className="border-t border-[var(--color-border-tertiary)] px-3 py-2">
              <div className={`mb-1 text-[11px] font-semibold ${isError ? 'text-[#ef4444]' : 'text-[var(--color-text-tertiary)]'}`}>
                {isError ? 'Error' : 'Result'}
              </div>
              <MarkdownContent content={result.result} compact />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function ToolCallList({ calls, results }: { calls: ToolCallRecord[]; results?: ToolResultRecord[] }) {
  const errors = calls
    .map((call) => ({ call, result: results?.find((r) => r.id === call.id) }))
    .filter(({ result }) => result?.result.startsWith('Error:'))
  return (
    <>
      {errors.length > 0 && (
        <div className="mb-2 space-y-1">
          {errors.map(({ call, result }) => (
            <div key={call.id} className="flex items-start gap-2 rounded-lg border border-[#fca5a5] bg-[#fef2f2] px-2.5 py-1.5 text-[11px] text-[#b91c1c]">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="mt-0.5 shrink-0" aria-hidden>
                <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1.4"/>
                <path d="M6 4v2.5M6 8h.01" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
              </svg>
              <span><span className="font-semibold font-mono">{call.name}</span> — {result?.result.slice('Error:'.length).trim().slice(0, 160)}</span>
            </div>
          ))}
        </div>
      )}
      <div className="my-2">
        {calls.map((call) => (
          <ToolCallCard
            key={call.id}
            call={call}
            result={results?.find((r) => r.id === call.id)}
          />
        ))}
      </div>
    </>
  )
}

const CRITIC_META: Record<string, { label: string; color: string; bg: string; border: string }> = {
  accept:   { label: 'Verified',  color: 'var(--color-accent)', bg: 'var(--color-accent-bg)', border: '#86efac' },
  escalate: { label: 'Escalated', color: 'var(--color-attention)', bg: 'var(--color-attention-bg)', border: '#fcd34d' },
  clarify:  { label: 'Needs clarification', color: '#1d4ed8', bg: '#eff6ff', border: '#93c5fd' },
}

function CriticBadge({ critic }: { critic: CriticVerdict }) {
  const m = CRITIC_META[critic.action] ?? CRITIC_META.accept!
  if (critic.action === 'accept') return null   // accepted = normal flow; only surface notable gates
  return (
    <div className="mb-2 flex items-start gap-2 rounded-lg border px-2.5 py-1.5 text-[11px]"
      style={{ borderColor: m.border, background: m.bg, color: m.color }}>
      <span className="shrink-0 font-semibold">{m.label}</span>
      <span className="text-[var(--color-text-secondary)]">{critic.reason}</span>
    </div>
  )
}

function MarkdownContent({ content, compact = false }: { content: string; compact?: boolean }) {
  const { settings } = useSettings()
  const isDark = settings.theme === 'dark'
  // Strip provenance/watermark HTML comments (e.g. `<!-- c2pa:ai-generated … -->`) that the backend
  // appends — they're metadata for the evidence layer, not text, and were leaking into the answer body.
  content = content.replace(/<!--\s*c2pa[\s\S]*?-->/gi, '').replace(/\n{3,}/g, '\n\n').trimEnd()
  // eslint-disable-next-line
  const codeStyle = (isDark ? oneDark : oneLight) as unknown as { [key: string]: React.CSSProperties }

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        // Paragraphs
        p: ({ children }) => (
          <p className={`text-[var(--color-text-primary)] ${compact ? 'text-[12px] leading-5' : 'text-[14px] leading-[1.75]'} mb-2 last:mb-0`}>
            {children}
          </p>
        ),
        // Headings
        h1: ({ children }) => <h1 className="mb-3 mt-4 text-xl font-bold text-[var(--color-text-primary)] first:mt-0">{children}</h1>,
        h2: ({ children }) => <h2 className="mb-2 mt-4 text-lg font-semibold text-[var(--color-text-primary)] first:mt-0">{children}</h2>,
        h3: ({ children }) => <h3 className="mb-2 mt-3 text-base font-semibold text-[var(--color-text-primary)] first:mt-0">{children}</h3>,
        // Lists
        ul: ({ children }) => <ul className="mb-2 ml-4 list-disc space-y-1 text-[14px] text-[var(--color-text-primary)]">{children}</ul>,
        ol: ({ children }) => <ol className="mb-2 ml-4 list-decimal space-y-1 text-[14px] text-[var(--color-text-primary)]">{children}</ol>,
        li: ({ children }) => <li className="leading-[1.7]">{children}</li>,
        // Blockquote
        blockquote: ({ children }) => (
          <blockquote className="my-2 border-l-2 border-[var(--color-border-primary)] pl-3 text-[var(--color-text-secondary)] italic">
            {children}
          </blockquote>
        ),
        // Horizontal rule
        hr: () => <hr className="my-4 border-[var(--color-border-secondary)]" />,
        // Emphasis
        strong: ({ children }) => <strong className="font-semibold text-[var(--color-text-primary)]">{children}</strong>,
        em: ({ children }) => <em className="italic text-[var(--color-text-primary)]">{children}</em>,
        del: ({ children }) => <del className="text-[var(--color-text-secondary)]">{children}</del>,
        // Links — inline citation markers ([1], [2]…) rendered as superscript badges; external links open in new tab
        a: ({ href, children }) => {
          if (href?.startsWith('#cite-')) {
            return (
              <a href={href} className="inline-flex items-center justify-center rounded px-[3px] py-px text-[11px] font-semibold leading-none text-[#1d4ed8] bg-[#eff6ff] hover:bg-[#dbeafe] align-super ml-0.5 no-underline transition-colors">
                {children}
              </a>
            )
          }
          return (
            <a
              href={href}
              onClick={(e) => { e.preventDefault(); if (href) window.open(href, '_blank', 'noopener,noreferrer') }}
              className="text-[#1d4ed8] underline decoration-[#bfdbfe] hover:decoration-[#1d4ed8] transition-colors"
            >
              {children}
            </a>
          )
        },
        // Images — render inline
        img: ({ src, alt }) => src ? (
          <span className="block my-3">
            <img
              src={src}
              alt={alt ?? ''}
              className="max-w-full rounded-xl border border-[var(--color-border-secondary)] shadow-sm"
              style={{ maxHeight: '480px', objectFit: 'contain' }}
            />
            {alt && <span className="mt-1 block text-[11px] text-[var(--color-text-tertiary)]">{alt}</span>}
          </span>
        ) : null,
        // Tables
        table: ({ children }) => (
          <div className="my-3 overflow-x-auto rounded-xl border border-[var(--color-border-secondary)]">
            <table className="min-w-full text-[13px]">{children}</table>
          </div>
        ),
        thead: ({ children }) => <thead className="bg-[var(--color-background-secondary)]">{children}</thead>,
        tbody: ({ children }) => <tbody className="divide-y divide-[var(--color-border-tertiary)]">{children}</tbody>,
        tr: ({ children }) => <tr>{children}</tr>,
        th: ({ children }) => <th className="px-3 py-2 text-left text-[11px] font-semibold text-[var(--color-text-secondary)]">{children}</th>,
        td: ({ children }) => <td className="px-3 py-2 text-[var(--color-text-primary)]">{children}</td>,
        // Inline code
        code: ({ children, className, node }) => {
          const match = /language-(\w+)/.exec(className ?? '')
          const isBlock = node?.position?.start?.line !== node?.position?.end?.line
            || String(children).includes('\n')

          if (isBlock || match) {
            const lang = match?.[1] ?? ''
            // Registry chart payload → render an actual chart instead of code.
            if (lang === 'noetica-chart') {
              try { return <ChartView spec={JSON.parse(String(children).replace(/\n$/, ''))} /> } catch { /* fall through to code */ }
            }
            return (
              <div className="group relative my-3 overflow-hidden rounded-xl border border-[var(--color-border-secondary)]">
                {lang && (
                  <div className="flex items-center justify-between border-b border-[var(--color-border-tertiary)] bg-[var(--color-background-secondary)] px-3 py-1.5">
                    <span className="font-mono text-[11px] font-semiboldr text-[var(--color-text-tertiary)]">{lang}</span>
                  </div>
                )}
                <SyntaxHighlighter
                  // eslint-disable-next-line
                  style={codeStyle as any}
                  language={lang || 'text'}
                  PreTag="div"
                  customStyle={{
                    margin: 0,
                    borderRadius: 0,
                    fontSize: '12px',
                    lineHeight: '1.6',
                    background: 'transparent',
                    padding: '12px 14px',
                  }}
                  codeTagProps={{ style: { fontFamily: 'var(--font-mono, ui-monospace, monospace)' } }}
                >
                  {String(children).replace(/\n$/, '')}
                </SyntaxHighlighter>
              </div>
            )
          }

          return (
            <code className="rounded-md bg-[var(--color-background-secondary)] border border-[var(--color-border-tertiary)] px-1.5 py-0.5 font-mono text-[12px] text-[var(--color-text-primary)]">
              {children}
            </code>
          )
        },
        // Pre — used when code blocks are in pre tags without language class
        pre: ({ children }) => (
          <div className="my-3 overflow-hidden rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)]">
            <pre className="overflow-x-auto p-3 font-mono text-[12px] leading-[1.6] text-[var(--color-text-primary)]">
              {children}
            </pre>
          </div>
        ),
      }}
    >
      {content}
    </ReactMarkdown>
  )
}

// The single quiet provenance footer — replaces the badge farm + governance line + Trace disclosure that
// used to hang off every answer. One muted row: where it ran · model · N sources (expandable) · verified,
// with "Inspect" opening the full telemetry in the right-rail Answer panel. Trust stated once, calmly.
function ProvenanceFooter({ message, onInspect }: { message: ChatMessage; onInspect?: (m: ChatMessage) => void }) {
  const [showSources, setShowSources] = useState(false)
  const g = message.governance
  const v = message.verification
  const prov = (g?.provider ?? '').toLowerCase()
  const tier = providerTier(g?.provider)   // device (blue) · mesh (grey, sovereign) · cloud (pink)

  // Sources shown inline = cited docs (or retrieval atoms), junk filtered out.
  const sources = (message.citations && message.citations.length > 0)
    ? cleanSources(message.citations.map((c) => ({ label: c.source, score: c.score })))
    : cleanSources(message.retrieval_trace?.document_sources ?? message.retrieval_trace?.sources)
  const verified = !!v || g?.grounded === true

  // Nothing worth a footer? (e.g. small-talk with no provenance) → render nothing.
  if (!g && !v && sources.length === 0) return null

  return (
    <div className="mt-2.5">
      <div className="flex items-center gap-0 text-[12px] text-[var(--color-text-tertiary)]">
        <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: TIER_META[tier].dot }} />
        <span className="ml-1.5" style={{ color: tier === 'device' ? undefined : TIER_META[tier].text }}>{tier === 'device' ? 'on-device' : prov}</span>
        {g?.model_routed && g.model_routed.toLowerCase() !== prov && <><span className="mx-2 text-[var(--color-border-secondary)]">·</span>{g.model_routed}</>}
        {sources.length > 0 && (
          <>
            <span className="mx-2 text-[var(--color-border-secondary)]">·</span>
            <button onClick={() => setShowSources((s) => !s)} className="inline-flex items-center gap-1 transition hover:text-[var(--color-text-secondary)]">
              <span className="text-[11px]">{showSources ? '▾' : '▸'}</span>{sources.length} source{sources.length === 1 ? '' : 's'}
            </button>
          </>
        )}
        {verified && <><span className="mx-2 text-[var(--color-border-secondary)]">·</span><span className="text-[var(--color-accent)]">verified</span></>}
        {onInspect && (
          <button
            onClick={() => onInspect(message)}
            className="ml-auto inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11.5px] transition hover:bg-[var(--color-background-secondary)] hover:text-[var(--color-accent,#7c8cf8)]"
            title="Inspect this answer — verification, sources, and the full trace"
          >
            Inspect ↗
          </button>
        )}
      </div>
      {showSources && sources.length > 0 && (
        <div className="mt-2 space-y-1.5 pl-1">
          {sources.slice(0, 8).map((s, i) => (
            <div key={i} className="flex items-baseline gap-2 text-[12px] text-[var(--color-text-secondary)]">
              <span className="w-3 shrink-0 tabular-nums text-[var(--color-text-tertiary)]">{i + 1}</span>
              <span className="min-w-0 flex-1 truncate">{s.label || 'document'}</span>
              {typeof s.score === 'number' && <span className="shrink-0 tabular-nums text-[var(--color-text-tertiary)]">{(s.score * 100).toFixed(0)}%</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

type MessageBubbleProps = {
  message: ChatMessage
  isLast?: boolean
  onExtractArtifact?: (content: string, messageId: string) => void
  onRegenerate?: () => void
  onResume?: () => void
  onFork?: (messageId: string) => void
  onEdit?: (messageId: string, newContent: string) => void
  onSpeak?: (content: string, id?: string) => void
  isSpeaking?: boolean
  onQuickPrompt?: (text: string) => void
  onFeedback?: (messageId: string, rating: 'up' | 'down') => void
  onPlanApprove?: (messageId: string) => void
  onPlanReject?: (messageId: string) => void
  onInspect?: (message: ChatMessage) => void
}

export function MessageBubble({ message, isLast, onExtractArtifact, onRegenerate, onResume, onFork, onEdit, onSpeak, isSpeaking, onQuickPrompt, onFeedback, onPlanApprove, onPlanReject, onInspect }: MessageBubbleProps) {
  const isUser = message.role === 'user'
  const [extracted, setExtracted] = useState(false)
  const [copied, setCopied] = useState(false)
  const [editing, setEditing] = useState(false)
  const [feedbackGiven, setFeedbackGiven] = useState<'up' | 'down' | null>(null)
  const [showActions, setShowActions] = useState(false)   // ⋯ overflow: Save / Fork / Speak
  const [editContent, setEditContent] = useState(message.content)
  const editRef = useRef<HTMLTextAreaElement>(null)
  const { settings } = useSettings()

  // Uniform reveal cadence for assistant replies. Live turns (created during this view) animate;
  // history (loaded from a stored session, i.e. created before the app opened) renders in full.
  const animate = !isUser && (settings.typingTokensPerSec ?? 0) > 0 &&
    Date.parse(message.created_at) >= APP_OPEN_TS - 1500
  const displayContent = useRevealedContent(message.content, {
    tokensPerSec: settings.typingTokensPerSec ?? 0,
    animate,
    id: message.id,
  })

  function handleCopy() {
    if (!message.content) return
    void navigator.clipboard.writeText(message.content).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  if (isUser) {
    return (
      <article className="group flex justify-end">
        <div className="max-w-[60%] space-y-1">
          {message.workspace_mode && message.workspace_mode !== 'Chat' && (
            <div className="flex justify-end">
              <span className="rounded-full bg-[var(--color-text-primary)] px-2.5 py-0.5 text-[11px] font-semibold text-[var(--color-background-primary)]">
                {message.workspace_mode}
              </span>
            </div>
          )}

          {editing ? (
            <div className="space-y-2">
              <textarea
                ref={editRef}
                className="min-h-[80px] w-full rounded-2xl border border-[#1d4ed8] bg-[#eff6ff] px-4 py-3 text-sm leading-6 text-[var(--color-text-primary)] outline-none shadow-sm resize-none"
                value={editContent}
                autoFocus
                onChange={(e) => setEditContent(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { onEdit?.(message.id, editContent.trim()); setEditing(false) }
                  if (e.key === 'Escape') { setEditing(false); setEditContent(message.content) }
                }}
              />
              <div className="flex justify-end gap-2">
                <button onClick={() => { setEditing(false); setEditContent(message.content) }}
                  className="rounded-full border border-[var(--color-border-tertiary)] bg-[var(--color-background-primary)] px-3 py-1 text-xs font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-background-secondary)]">
                  Cancel
                </button>
                <button
                  onClick={() => { onEdit?.(message.id, editContent.trim()); setEditing(false) }}
                  disabled={!editContent.trim() || editContent.trim() === message.content}
                  className="rounded-full bg-[#1d4ed8] px-3 py-1 text-xs font-semibold text-white hover:bg-[#1e40af] disabled:opacity-40"
                >
                  Send edit
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="rounded-2xl bg-[var(--color-background-secondary)] px-3.5 py-2 text-sm leading-6 text-[var(--color-text-primary)]">
                {message.content && <p className="whitespace-pre-wrap">{message.content}</p>}
                {message.attachments && message.attachments.length > 0 && (
                  <AttachmentList attachments={message.attachments} />
                )}
              </div>
              <div className="flex justify-end gap-2 opacity-0 transition-opacity group-hover:opacity-100">
                {onEdit && message.content && (
                  <button onClick={() => { setEditContent(message.content); setEditing(true) }}
                    className="flex items-center gap-1 rounded-lg px-2 py-0.5 text-[11px] text-[var(--color-text-tertiary)] transition hover:text-[var(--color-text-secondary)]">
                    Edit
                  </button>
                )}
                <button onClick={handleCopy}
                  className="flex items-center gap-1 rounded-lg px-2 py-0.5 text-[11px] text-[var(--color-text-tertiary)] transition hover:text-[var(--color-text-secondary)]">
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
            </>
          )}
        </div>
      </article>
    )
  }

  function handleExtract() {
    if (!message.content || !onExtractArtifact) return
    onExtractArtifact(message.content, message.id)
    setExtracted(true)
    setTimeout(() => setExtracted(false), 2000)
  }

  // A content-less assistant message is just the streaming placeholder — including the
  // thinking-only phase of reasoning models (deepseek-r1 etc.), which stream <think>
  // before any answer. Don't render its bubble: the single TypingIndicator below is the
  // one streaming loader. Once real content arrives, the bubble renders (thinking folds
  // into its own disclosure). This kills the "two icons" double-loader.
  if (!message.content && !message.tool_calls?.length && !message.plan?.steps?.length) return null

  return (
    <article className="group">
      <div className="min-w-0">

        {/* Extended thinking */}
        {message.thinking && (
          <details className="mb-3 rounded-xl border border-[var(--color-border-tertiary)] bg-[var(--color-background-secondary)]">
            <summary className="cursor-pointer select-none px-3 py-2 text-xs font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]">
              Extended thinking
            </summary>
            <p className="px-3 pb-3 pt-1 whitespace-pre-wrap text-xs leading-6 text-[var(--color-text-secondary)]">{message.thinking}</p>
          </details>
        )}

        {/* Live todo checklist — only while the answer is still composing; once content lands it's just
            after-the-fact clutter, so it folds away (the full plan lives in the Answer inspector). */}
        {message.plan && (!message.content || message.awaitingApproval) && <PlanChecklist plan={message.plan} />}

        {/* Plan-mode approval gate — shown when the agent produced a plan and is waiting for the user to approve before executing */}
        {message.awaitingApproval && (
          <div className="my-2 flex items-center gap-2 rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] px-3 py-2">
            <span className="flex-1 text-[11px] text-[var(--color-text-secondary)]">Ready to execute — approve to run this plan or reject to revise.</span>
            <button
              onClick={() => onPlanReject?.(message.id)}
              className="rounded-md border border-[var(--color-border-secondary)] px-2.5 py-1 text-[11px] font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-background-tertiary)] transition"
            >
              Reject
            </button>
            <button
              onClick={() => onPlanApprove?.(message.id)}
              className="rounded-md bg-[#7c3aed] px-2.5 py-1 text-[11px] font-medium text-white hover:bg-[#6d28d9] transition"
            >
              Approve &amp; Execute
            </button>
          </div>
        )}

        {/* Critic gate — escalate/clarify shown above content; accept is silent */}
        {message.deliberation?.critic && (
          <CriticBadge critic={message.deliberation.critic} />
        )}

        {/* Tool calls */}
        {message.tool_calls && message.tool_calls.length > 0 && (
          <ToolCallList calls={message.tool_calls} results={message.tool_results} />
        )}

        {/* Main content — markdown rendered, with gen-ui blocks and clickable inline citation markers */}
        {message.content && (() => {
          // document_sources = user-uploaded doc chunks; sources = OCW/brain retrieval — show whichever
          // exists, with dev/test exhaust filtered out so junk never drives citation superscripts.
          const docSources = cleanSources(message.retrieval_trace?.document_sources?.length
            ? message.retrieval_trace.document_sources
            : message.retrieval_trace?.sources?.filter((s) => s.label))

          // If the content contains generative-UI specs, split and render each segment.
          if (hasGenUI(displayContent)) {
            const segments = splitGenUI(displayContent)
            return (
              <div>
                {segments.map((seg, i) =>
                  seg.type === 'ui'
                    ? <GenUIBlock key={i} spec={seg.spec} />
                    : seg.text.trim() ? <MarkdownContent key={i} content={seg.text} /> : null
                )}
              </div>
            )
          }

          if (!docSources || docSources.length === 0) return <MarkdownContent content={displayContent} />
          // Keep inline [n] citation superscripts (minimal, Tufte-fine); the source list itself moved to
          // the provenance footer (expandable) + the Answer inspector, so no footnote block here.
          const citedContent = displayContent.replace(/\[([1-9])\](?!\()/g, (_m, n) => `[[${n}]](#cite-${n})`)
          return <MarkdownContent content={citedContent} />
        })()}

        {/* One quiet provenance footer — replaces the badge farm + governance line + Trace disclosure.
            The moat (verification, sources, governance) is stated once here; depth is one click away in
            the right-rail Answer inspector. */}
        {message.content && <ProvenanceFooter message={message} onInspect={onInspect} />}

        {/* Build clarifier — deterministic multiple-choice scaffold card */}
        {message.build && <BuildCard spec={message.build} />}

        {/* Quick replies — local dialogue-layer suggestion chips (Rasa-style buttons) */}
        {message.quick_replies && message.quick_replies.length > 0 && onQuickPrompt && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {message.quick_replies.map((qr) => (
              <button
                key={qr}
                onClick={() => onQuickPrompt(qr)}
                className="rounded-full border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] px-3 py-1 text-[12px] text-[var(--color-text-secondary)] transition hover:border-[var(--color-border-primary)] hover:text-[var(--color-text-primary)]"
              >
                {qr}
              </button>
            ))}
          </div>
        )}

        {/* Action bar — Copy · Regenerate · feedback inline; Save / Fork / Speak behind a ⋯ overflow.
            While speaking, the bar stays visible and an inline Stop is surfaced so it's one click. */}
        {message.content && (
          <div className={`mt-1.5 flex items-center gap-2 transition-opacity ${isSpeaking ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
            <button onClick={handleCopy}
              className="flex items-center gap-1 rounded px-1.5 py-1 text-[11px] text-[var(--color-text-tertiary)] transition hover:text-[var(--color-text-secondary)]">
              <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden>
                <rect x="1" y="3" width="6" height="7" rx="1" stroke="currentColor" strokeWidth="1.3"/>
                <path d="M3.5 3V2a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
              </svg>
              {copied ? 'Copied' : 'Copy'}
            </button>
            {isLast && onRegenerate && (
              <button onClick={onRegenerate}
                className="flex items-center gap-1 rounded px-1.5 py-1 text-[11px] text-[var(--color-text-tertiary)] transition hover:text-[var(--color-text-secondary)]">
                <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden>
                  <path d="M1.5 5.5A4 4 0 0 1 9 3M9.5 5.5A4 4 0 0 1 2 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                  <path d="M9 1.5v2h-2M2 9.5v-2h2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                Regenerate
              </button>
            )}
            {onFeedback && (
              <span className="flex items-center gap-0.5">
                <button
                  onClick={() => { setFeedbackGiven('up'); onFeedback(message.id, 'up') }}
                  title="Good answer"
                  className={`rounded p-1 text-[11px] transition ${feedbackGiven === 'up' ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-tertiary)] hover:text-[var(--color-accent)]'}`}
                >
                  <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden>
                    <path d="M5.5 1.5l1.3 3H10l-2.6 1.9 1 3L5.5 7.6 3.1 9.4l1-3L1.5 4.5h3.2L5.5 1.5z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" fill={feedbackGiven === 'up' ? 'currentColor' : 'none'}/>
                  </svg>
                </button>
                <button
                  onClick={() => { setFeedbackGiven('down'); onFeedback(message.id, 'down') }}
                  title="Poor answer"
                  className={`rounded p-1 text-[11px] transition ${feedbackGiven === 'down' ? 'text-[#dc2626]' : 'text-[var(--color-text-tertiary)] hover:text-[#dc2626]'}`}
                >
                  <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden>
                    <path d="M2 2h1.5v5H2V2zM5.5 2h.5l2 3.5L6.5 9H4l1-3H3.5L5.5 2z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" fill={feedbackGiven === 'down' ? 'currentColor' : 'none'}/>
                  </svg>
                </button>
              </span>
            )}

            {/* Inline Stop while speaking — keeps the toggle one click even though Speak lives in the overflow */}
            {onSpeak && isSpeaking && (
              <button onClick={() => onSpeak(message.content.replace(/\[.*?\]/g, '').trim(), message.id)}
                title="Stop speaking"
                className="flex items-center gap-1 rounded px-1.5 py-1 text-[11px] text-[var(--color-text-secondary)] transition">
                <svg width="11" height="11" viewBox="0 0 11 11" fill="currentColor" aria-hidden><rect x="2" y="2" width="7" height="7" rx="1.2"/></svg>
                Stop
              </button>
            )}

            {/* Overflow — Save as artifact / Fork / Speak */}
            {(onExtractArtifact || onFork || (onSpeak && !isSpeaking)) && (
              <div className="relative">
                <button onClick={() => setShowActions((v) => !v)} title="More actions"
                  className="flex items-center rounded px-1 py-1 text-[var(--color-text-tertiary)] transition hover:text-[var(--color-text-secondary)]">
                  <svg width="13" height="13" viewBox="0 0 13 13" fill="currentColor" aria-hidden>
                    <circle cx="2.5" cy="6.5" r="1.1"/><circle cx="6.5" cy="6.5" r="1.1"/><circle cx="10.5" cy="6.5" r="1.1"/>
                  </svg>
                </button>
                {showActions && (
                  <div className="absolute bottom-8 left-0 z-50 w-44 rounded-xl border border-[var(--color-border-tertiary)] bg-[var(--color-background-primary)] py-1 shadow-lg">
                    {onExtractArtifact && (
                      <button onClick={() => { handleExtract(); setShowActions(false) }}
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-[var(--color-text-secondary)] transition hover:bg-[var(--color-background-secondary)]">
                        <svg width="12" height="12" viewBox="0 0 11 11" fill="none" aria-hidden><path d="M2 9h7M5.5 1v6M3 4.5l2.5-2.5 2.5 2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
                        {extracted ? 'Saved' : 'Save as artifact'}
                      </button>
                    )}
                    {onFork && (
                      <button onClick={() => { onFork(message.id); setShowActions(false) }}
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-[var(--color-text-secondary)] transition hover:bg-[var(--color-background-secondary)]">
                        <svg width="12" height="12" viewBox="0 0 11 11" fill="none" aria-hidden><circle cx="2" cy="2.5" r="1.3" stroke="currentColor" strokeWidth="1.2"/><circle cx="9" cy="2.5" r="1.3" stroke="currentColor" strokeWidth="1.2"/><circle cx="5.5" cy="9" r="1.3" stroke="currentColor" strokeWidth="1.2"/><path d="M2 3.8v1.5a2 2 0 0 0 2 2h3a2 2 0 0 0 2-2V3.8M5.5 7.7V5.3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
                        Fork
                      </button>
                    )}
                    {onSpeak && !isSpeaking && (
                      <button onClick={() => { onSpeak(message.content.replace(/\[.*?\]/g, '').trim(), message.id); setShowActions(false) }}
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-[var(--color-text-secondary)] transition hover:bg-[var(--color-background-secondary)]">
                        <svg width="12" height="12" viewBox="0 0 11 11" fill="none" aria-hidden><path d="M2 4H1v3h1l3 2.5V1.5L2 4z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/><path d="M8 3.5c.8.6 1.3 1.3 1.3 2s-.5 1.4-1.3 2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
                        Speak
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Governance line (on-device/provider · model · method · latency · tokens) moved to the
            Answer inspector — the provenance footer above carries the one-line summary. */}
        {message.stopped && (
          <div className="mt-1.5 inline-flex items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-full border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] px-2 py-0.5 text-[11px] font-medium text-[var(--color-text-tertiary)]">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--color-attention)]" />
              Stopped
            </span>
            {isLast && onResume && (
              <button onClick={onResume}
                className="inline-flex items-center gap-1 rounded-full border border-[var(--color-border-secondary)] px-2 py-0.5 text-[11px] font-medium text-[var(--color-text-secondary)] transition hover:text-[var(--color-text-primary)] hover:border-[var(--color-border-primary)]"
                title="Continue this response from where it stopped">
                ▶ Resume
              </button>
            )}
          </div>
        )}

        {/* Contradictions are a real warning — always visible, outside the disclosure. */}
        {message.content && message.value_judgment && message.value_judgment.contradictions.length > 0 && (
          <div className="mt-2 space-y-1">
            {message.value_judgment.contradictions.map((c, i) => (
              <div key={i} className="rounded-lg border border-[#fca5a5] bg-[#fef2f2] px-2 py-1 text-[11px] text-[#b91c1c]">
                ⚠ contradicts {c.kind}: <span className="italic">{c.statement.slice(0, 90)}</span>
              </div>
            ))}
          </div>
        )}

      </div>
    </article>
  )
}
