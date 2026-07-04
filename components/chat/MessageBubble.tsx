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
import { GovernanceTrail } from '@/components/governance/GovernanceTrail'
import { NoeticaMark } from '@/components/brand/NoeticaMark'
import { BuildCard } from '@/components/chat/BuildCard'
import { ChartView } from '@/components/chat/ChartView'
import { SteeringDiff } from '@/components/steering/SteeringDiff'
import { GenUIBlock, hasGenUI, splitGenUI } from '@/components/chat/GenUIRenderer'
import type { ChatMessage, ToolCallRecord, ToolResultRecord, CriticVerdict } from '@/lib/types/message'
import type { PendingAttachment } from '@/lib/types/attachment'
import { useSettings } from '@/lib/settings/context'

const KIND_ICON: Record<string, string> = {
  image: '🖼',
  pdf: '📄',
  text: '📝',
  code: '⌥',
  binary: '📦',
}

function AttachmentList({ attachments }: { attachments: PendingAttachment[] }) {
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {attachments.map((a) => (
        <div key={a.clientId} className="flex items-center gap-1.5 rounded-xl border border-[#93c5fd] bg-[#eff6ff] px-2.5 py-1.5 text-xs">
          {a.kind === 'image' ? (
            <img src={`data:${a.mimeType};base64,${a.base64}`} alt={a.name} className="h-8 w-8 rounded-lg object-cover" />
          ) : (
            <span>{KIND_ICON[a.kind] ?? '📎'}</span>
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
const DISPATCH_ROLE_META: Record<string, { icon: string; color: string }> = {
  researcher: { icon: '🔎', color: '#0ea5e9' },
  coder:      { icon: '⌨️', color: '#8b5cf6' },
  reviewer:   { icon: '🛡️', color: '#f59e0b' },
  analyst:    { icon: '📊', color: '#10b981' },
  planner:    { icon: '🗺️', color: '#6366f1' },
  general:    { icon: '🤖', color: '#64748b' },
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
        <span className="shrink-0 text-[13px] leading-none">{meta.icon}</span>
        <span className="shrink-0 text-[11px] font-semibold capitalize" style={{ color: meta.color }}>Dispatched {role}</span>
        <span className="min-w-0 flex-1 truncate text-[10px] text-[var(--color-text-tertiary)]">{task}</span>
        <span className="shrink-0 text-[10px] text-[var(--color-text-tertiary)]">{running ? 'running…' : (open ? '▲' : '▼')}</span>
      </button>
      {open && (
        <div className="border-t border-[var(--color-border-tertiary)] bg-[var(--color-background-secondary)] px-3 py-2">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">Task</div>
          <p className="mb-2 whitespace-pre-wrap text-[12px] text-[var(--color-text-secondary)]">{task}</p>
          {result && (
            <>
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">Result</div>
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
          isError ? 'bg-[#ef4444]' : 'bg-[#22c55e]'
        }`} />
        {/* tool icon */}
        <svg width="11" height="11" viewBox="0 0 14 14" fill="none" aria-hidden className="shrink-0 text-[var(--color-text-tertiary)]">
          <path d="M2 7h10M7 2v10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
          <rect x="1" y="1" width="12" height="12" rx="3" stroke="currentColor" strokeWidth="1.2"/>
        </svg>
        <span className="flex-1 font-mono text-[11px] font-semibold text-[var(--color-text-primary)]">{call.name}</span>
        <span className="text-[10px] text-[var(--color-text-tertiary)]">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="border-t border-[var(--color-border-tertiary)] bg-[var(--color-background-secondary)]">
          {/* Input */}
          <div className="px-3 py-2">
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">Input</div>
            <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-5 text-[var(--color-text-secondary)]">{inputStr}</pre>
          </div>
          {/* Result */}
          {result && (
            <div className="border-t border-[var(--color-border-tertiary)] px-3 py-2">
              <div className={`mb-1 text-[10px] font-semibold uppercase tracking-wide ${isError ? 'text-[#ef4444]' : 'text-[var(--color-text-tertiary)]'}`}>
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
  accept:   { label: 'Verified',  color: '#15803d', bg: '#f0fdf4', border: '#86efac' },
  escalate: { label: 'Escalated', color: '#b45309', bg: '#fffbeb', border: '#fcd34d' },
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
              <a href={href} className="inline-flex items-center justify-center rounded px-[3px] py-px text-[9px] font-semibold leading-none text-[#1d4ed8] bg-[#eff6ff] hover:bg-[#dbeafe] align-super ml-0.5 no-underline transition-colors">
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
        th: ({ children }) => <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">{children}</th>,
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
                    <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)]">{lang}</span>
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

// The buying reason made visible: a small chip showing HOW the answer was proven.
// Color-codes by trust tier — computed/replay-exact (emerald) > reasoned (blue/amber) > generated (grey).
function VerificationBadge({ verification }: { verification: NonNullable<ChatMessage['verification']> }) {
  const method = (verification.method ?? '').toLowerCase()
  const isComputed = verification.computed === true
  const isReasoned = !isComputed && (method.includes('reason') || method.includes('self-consistency') || verification.badge.startsWith('Reasoned'))
  const tier = isComputed
    ? { color: '#16a34a', bg: 'rgba(22,163,74,0.08)', border: 'rgba(22,163,74,0.4)', glyph: '🔒' }
    : isReasoned
      ? { color: '#2563eb', bg: 'rgba(37,99,235,0.08)', border: 'rgba(37,99,235,0.4)', glyph: '◆' }
      : { color: '#64748b', bg: 'var(--color-background-secondary)', border: 'var(--color-border-secondary)', glyph: '·' }

  const tooltip = [
    verification.receiptRef ? `receipt: ${verification.receiptRef}` : null,
    verification.runRef ? `run: ${verification.runRef}` : null,
    `replay: ${verification.replayClass}`,
    verification.sealable ? 'sealable' : null,
  ].filter(Boolean).join(' · ')

  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-xs font-medium"
      style={{ color: tier.color, background: tier.bg, borderColor: tier.border }}
      title={tooltip || verification.badge}
    >
      <span aria-hidden>{tier.glyph}</span>
      <span>{verification.badge}</span>
      {verification.attested && (
        <span
          className="ml-0.5 inline-flex items-center gap-0.5 rounded-full px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide"
          style={{ background: tier.color, color: 'var(--color-background-primary)' }}
          title="Sealed onto the evidence fabric"
        >
          🔏 sealed
        </span>
      )}
    </span>
  )
}

// Onyx/NotebookLM-grade citation surface — a compact numbered row of the sources the answer is grounded in.
function CitationsRow({ citations }: { citations: NonNullable<ChatMessage['citations']> }) {
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-[var(--color-text-tertiary)]">
      {citations.map((c) => (
        <span
          key={`${c.n}-${c.ref}`}
          className="inline-flex items-center gap-1"
          title={`${c.source}${c.score !== undefined ? ` · ${(c.score * 100).toFixed(0)}% match` : ''}${c.grounding_status ? ` · ${c.grounding_status}` : ''}`}
        >
          <span className="font-semibold text-[var(--color-text-secondary)]">[{c.n}]</span>
          <span className="max-w-[220px] truncate">{c.source}</span>
        </span>
      ))}
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
  onSpeak?: (content: string) => void
  onQuickPrompt?: (text: string) => void
  onFeedback?: (messageId: string, rating: 'up' | 'down') => void
  onPlanApprove?: (messageId: string) => void
  onPlanReject?: (messageId: string) => void
}

export function MessageBubble({ message, isLast, onExtractArtifact, onRegenerate, onResume, onFork, onEdit, onSpeak, onQuickPrompt, onFeedback, onPlanApprove, onPlanReject }: MessageBubbleProps) {
  const isUser = message.role === 'user'
  const [extracted, setExtracted] = useState(false)
  const [copied, setCopied] = useState(false)
  const [editing, setEditing] = useState(false)
  const [feedbackGiven, setFeedbackGiven] = useState<'up' | 'down' | null>(null)
  const [editContent, setEditContent] = useState(message.content)
  const editRef = useRef<HTMLTextAreaElement>(null)

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
    <article className="group flex gap-3">
      <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--color-text-primary)] text-[var(--color-background-primary)]">
        <NoeticaMark className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-1 text-[11px] font-medium text-[var(--color-text-secondary)]">
          Noetica
        </div>

        {/* Extended thinking */}
        {message.thinking && (
          <details className="mb-3 rounded-xl border border-[var(--color-border-tertiary)] bg-[var(--color-background-secondary)]">
            <summary className="cursor-pointer select-none px-3 py-2 text-xs font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]">
              Extended thinking
            </summary>
            <p className="px-3 pb-3 pt-1 whitespace-pre-wrap text-xs leading-6 text-[var(--color-text-secondary)]">{message.thinking}</p>
          </details>
        )}

        {/* Live todo checklist (streamed plan + step updates) */}
        {message.plan && <PlanChecklist plan={message.plan} />}

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
          // document_sources = user-uploaded doc chunks; sources = OCW/brain retrieval — show whichever exists
          const docSources = message.retrieval_trace?.document_sources?.length
            ? message.retrieval_trace.document_sources
            : message.retrieval_trace?.sources?.filter((s) => s.label)

          // If the content contains generative-UI specs, split and render each segment.
          if (hasGenUI(message.content)) {
            const segments = splitGenUI(message.content)
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

          if (!docSources || docSources.length === 0) return <MarkdownContent content={message.content} />
          // Rewrite [n] citation markers (1–9) to markdown links so the a-renderer turns them into superscripts.
          // Only rewrite numeric-only brackets that look like citations (not e.g. "[code]" or "[…]").
          const citedContent = message.content.replace(/\[([1-9])\](?!\()/g, (_m, n) => `[[${n}]](#cite-${n})`)
          const topSources = docSources.slice(0, 5)
          return (
            <>
              <MarkdownContent content={citedContent} />
              <div className="mt-3 border-t border-[var(--color-border-tertiary)] pt-2 space-y-1.5">
                {topSources.map((s, i) => (
                  <div key={i} id={`cite-${i + 1}`} className="flex items-start gap-2 text-[11px] text-[var(--color-text-tertiary)] scroll-mt-2">
                    <span className="shrink-0 inline-flex h-4 w-4 items-center justify-center rounded text-[9px] font-semibold bg-[var(--color-background-secondary)] text-[var(--color-text-secondary)]">{i + 1}</span>
                    <span className="min-w-0 truncate text-[var(--color-text-secondary)]">{s.label || 'document'}</span>
                    <span className="shrink-0 tabular-nums text-[var(--color-text-tertiary)]">{(s.score * 100).toFixed(0)}%</span>
                  </div>
                ))}
              </div>
            </>
          )
        })()}

        {/* The moat made visible — verification badge + inline citations, the proof on every answer. */}
        {message.content && (message.verification || (message.citations && message.citations.length > 0)) && (
          <div className="mt-2 space-y-1">
            {message.verification && <VerificationBadge verification={message.verification} />}
            {message.citations && message.citations.length > 0 && <CitationsRow citations={message.citations} />}
          </div>
        )}

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

        {/* Action bar */}
        {message.content && (
          <div className="mt-1.5 flex items-center gap-2 opacity-0 transition-opacity group-hover:opacity-100">
            <button onClick={handleCopy}
              className="flex items-center gap-1 rounded px-1.5 py-1 text-[11px] text-[var(--color-text-tertiary)] transition hover:text-[var(--color-text-secondary)]">
              <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden>
                <rect x="1" y="3" width="6" height="7" rx="1" stroke="currentColor" strokeWidth="1.3"/>
                <path d="M3.5 3V2a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
              </svg>
              {copied ? 'Copied' : 'Copy'}
            </button>
            {onExtractArtifact && (
              <button onClick={handleExtract}
                className="flex items-center gap-1 rounded px-1.5 py-1 text-[11px] text-[var(--color-text-tertiary)] transition hover:text-[var(--color-text-secondary)]">
                <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden>
                  <path d="M2 9h7M5.5 1v6M3 4.5l2.5-2.5 2.5 2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                {extracted ? 'Saved' : 'Save as artifact'}
              </button>
            )}
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
            {onFork && (
              <button onClick={() => onFork(message.id)}
                className="flex items-center gap-1 rounded px-1.5 py-1 text-[11px] text-[var(--color-text-tertiary)] transition hover:text-[var(--color-text-secondary)]">
                <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden>
                  <circle cx="2" cy="2.5" r="1.3" stroke="currentColor" strokeWidth="1.2"/>
                  <circle cx="9" cy="2.5" r="1.3" stroke="currentColor" strokeWidth="1.2"/>
                  <circle cx="5.5" cy="9" r="1.3" stroke="currentColor" strokeWidth="1.2"/>
                  <path d="M2 3.8v1.5a2 2 0 0 0 2 2h3a2 2 0 0 0 2-2V3.8M5.5 7.7V5.3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                </svg>
                Fork
              </button>
            )}
            {onSpeak && message.content && (
              <button onClick={() => onSpeak(message.content.replace(/\[.*?\]/g, '').trim())}
                className="flex items-center gap-1 rounded px-1.5 py-1 text-[11px] text-[var(--color-text-tertiary)] transition hover:text-[var(--color-text-secondary)]"
                title="Speak aloud">
                <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden>
                  <path d="M2 4H1v3h1l3 2.5V1.5L2 4z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
                  <path d="M8 3.5c.8.6 1.3 1.3 1.3 2s-.5 1.4-1.3 2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                  <path d="M7 4.5c.4.3.7.6.7 1s-.3.7-.7 1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                </svg>
                Speak
              </button>
            )}
            {onFeedback && (
              <span className="ml-1 flex items-center gap-0.5 border-l border-[var(--color-border-tertiary)] pl-2">
                <button
                  onClick={() => { setFeedbackGiven('up'); onFeedback(message.id, 'up') }}
                  title="Good answer"
                  className={`rounded p-1 text-[11px] transition ${feedbackGiven === 'up' ? 'text-[#16a34a]' : 'text-[var(--color-text-tertiary)] hover:text-[#16a34a]'}`}
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
          </div>
        )}

        {message.content && message.governance && (message.governance.model_routed || message.governance.input_tokens || message.governance.output_tokens || message.governance.latency_ms) && (
          <div className="mt-1.5 flex items-center gap-3 text-[10px] text-[var(--color-text-tertiary)]">
            {(() => {
              const prov = (message.governance.provider ?? '').toLowerCase()
              const local = prov === '' || prov === 'ollama' || prov === 'noetica' || prov === 'local'
              return (
                <span className="flex items-center gap-1 font-semibold"
                  title={local ? 'Answered entirely on this device — nothing left your machine' : `Routed to ${prov} — this turn left your device`}
                  style={{ color: local ? '#16a34a' : '#d97706' }}>
                  {local ? '🔒 on-device' : `↗ ${prov}`}
                </span>
              )
            })()}
            {message.governance.model_routed && (
              <span className="flex items-center gap-1" title={message.governance.model_route_reason || undefined}>
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-[#22c55e]" />
                {message.governance.model_routed}
                {message.governance.model_route_reason && (
                  <span className="text-[var(--color-text-tertiary)]" aria-hidden>ⓘ</span>
                )}
              </span>
            )}
            {message.governance.method && (() => {
              // Provenance: HOW this answer was produced — the verifiability signal (P2.6).
              const M: Record<string, { label: string; title: string; color: string }> = {
                recall: { label: 'recalled', title: 'Replayed from a prior verified turn (decidable recall) — not re-generated', color: '#7c3aed' },
                'graphrag-global': { label: 'synthesized', title: 'Synthesized across your knowledge-graph community themes', color: '#0891b2' },
                extractive: { label: 'from source', title: 'Extracted verbatim from your cited documents — cannot hallucinate', color: '#16a34a' },
              }
              const m = M[message.governance.method!]
              return m ? <span className="flex items-center gap-1 font-medium" title={m.title} style={{ color: m.color }}>◆ {m.label}</span> : null
            })()}
            {message.governance.grounded && !message.governance.method && (
              <span className="flex items-center gap-1" title="Grounded in retrieved evidence" style={{ color: '#16a34a' }}>✓ grounded</span>
            )}
            {message.governance.latency_ms > 0 && (
              <span>{(message.governance.latency_ms / 1000).toFixed(1)}s</span>
            )}
            {(message.governance.input_tokens || message.governance.output_tokens) && (
              <span>
                {message.governance.input_tokens?.toLocaleString() ?? '–'} in · {message.governance.output_tokens?.toLocaleString() ?? '–'} out
              </span>
            )}
          </div>
        )}
        {message.stopped && (
          <div className="mt-1.5 inline-flex items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-full border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] px-2 py-0.5 text-[10px] font-medium text-[var(--color-text-tertiary)]">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-[#d97706]" />
              Stopped
            </span>
            {isLast && onResume && (
              <button onClick={onResume}
                className="inline-flex items-center gap-1 rounded-full border border-[var(--color-border-secondary)] px-2 py-0.5 text-[10px] font-medium text-[var(--color-text-secondary)] transition hover:text-[var(--color-text-primary)] hover:border-[var(--color-border-primary)]"
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
              <div key={i} className="rounded-lg border border-[#fca5a5] bg-[#fef2f2] px-2 py-1 text-[10px] text-[#b91c1c]">
                ⚠ contradicts {c.kind}: <span className="italic">{c.statement.slice(0, 90)}</span>
              </div>
            ))}
          </div>
        )}

        {/* One disclosure for all the governance / trace depth — keeps the thread clean. */}
        {message.content && (
          (message.deliberation && message.deliberation.candidates.length > 1) ||
          message.discipline ||
          message.value_judgment ||
          (message.retrieval_trace && (message.retrieval_trace.sources.length > 0 || message.retrieval_trace.beliefs_injected > 0 || (message.retrieval_trace.memory_sources?.length ?? 0) > 0 || (message.retrieval_trace.episode_sources?.length ?? 0) > 0)) ||
          (message.grounding && (!!message.grounding.domain || message.grounding.topics.length > 0 || message.grounding.terms.length > 0)) ||
          message.steering_result ||
          message.governance
        ) && (
          <details className="group/trace mt-2 text-[11px]">
            <summary className="flex cursor-pointer select-none items-center gap-1.5 py-1 text-[11px] text-[var(--color-text-tertiary)] transition hover:text-[var(--color-text-secondary)]">
              <span className="text-[9px] transition group-open/trace:rotate-90">▶</span>
              {message.value_judgment && (
                <span className={`inline-block h-1.5 w-1.5 rounded-full ${
                  message.value_judgment.verdict === 'grounded' ? 'bg-[#16a34a]'
                  : message.value_judgment.verdict === 'contradiction' ? 'bg-[#dc2626]'
                  : 'bg-[#d97706]'
                }`} />
              )}
              <span className="font-medium">Trace</span>
              <span className="text-[10px] text-[var(--color-text-tertiary)]">
                {message.value_judgment ? message.value_judgment.verdict : ''}
                {message.discipline ? ` · ${message.discipline.posture}` : ''}
                {message.retrieval_trace && message.retrieval_trace.sources.length > 0 ? ` · ${message.retrieval_trace.sources.length} atom${message.retrieval_trace.sources.length === 1 ? '' : 's'}` : ''}
              </span>
            </summary>
            <div className="mt-1 space-y-3 rounded-xl border border-[var(--color-border-tertiary)] bg-[var(--color-background-secondary)] px-3 py-2.5">
              {/* Value judgment */}
              {message.value_judgment && (
                <div className="text-[10px] text-[var(--color-text-tertiary)]">
                  <span className="font-medium uppercase tracking-wide text-[var(--color-text-secondary)]">Value judgment</span>
                  {' '}— {message.value_judgment.verdict} · worth {(message.value_judgment.worth * 100).toFixed(0)}% · grounding {(message.value_judgment.grounding * 100).toFixed(0)}%
                  {message.value_judgment.graph_grounding !== undefined ? ` · graph ${(message.value_judgment.graph_grounding * 100).toFixed(0)}%` : ''}
                  {message.value_judgment.novel_claims && message.value_judgment.novel_claims.length > 0 && (
                    <div className="mt-1">Novel (not in graph): {message.value_judgment.novel_claims.slice(0, 5).join(', ')}</div>
                  )}
                </div>
              )}
              {/* Glossary grounding — what the FRONTIER-AUTHORED canon recognized in the turn (the moat, made visible) */}
              {message.grounding && (!!message.grounding.domain || message.grounding.topics.length > 0 || message.grounding.terms.length > 0) && (
                <div className="text-[10px] text-[var(--color-text-tertiary)]">
                  <span className="font-medium uppercase tracking-wide text-[var(--color-text-secondary)]">Grounding</span>
                  {message.grounding.domain ? <> — domain <span className="text-[var(--color-text-secondary)]">{message.grounding.domain}</span></> : ''}
                  {message.grounding.terms.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {message.grounding.terms.slice(0, 12).map((t, i) => (
                        <span key={`gt-${i}`} className="inline-flex items-center gap-1 rounded-full border border-[#0ea5e9]/40 bg-[#0ea5e9]/5 px-2 py-0.5 text-[10px] text-[var(--color-text-secondary)]" title="canon term recognized — frontier-authored glossary, not model-extracted">
                          <span className="text-[#0ea5e9]">◆</span>{t}
                        </span>
                      ))}
                    </div>
                  )}
                  {message.grounding.topics.length > 0 && (
                    <div className="mt-1">topics: {message.grounding.topics.slice(0, 6).join(' · ')}</div>
                  )}
                </div>
              )}
              {/* Reasoning trace */}
              {message.retrieval_trace && ((message.retrieval_trace.sources?.length ?? 0) > 0 || message.retrieval_trace.beliefs_injected > 0 || (message.retrieval_trace.memory_sources?.length ?? 0) > 0 || (message.retrieval_trace.episode_sources?.length ?? 0) > 0) && (
                <div className="space-y-2">
                  <div className="text-[10px] uppercase tracking-wide text-[var(--color-text-secondary)]">Reasoning trace</div>
                  {(message.retrieval_trace.timings?.length ?? 0) > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {message.retrieval_trace.timings?.map((t) => (
                        <span key={t.pattern} className="inline-flex items-center gap-1 rounded-full border border-[var(--color-border-tertiary)] px-2 py-0.5 text-[10px] text-[var(--color-text-secondary)]">
                          {t.pattern} · {t.durationMs}ms · {t.hits} hit{t.hits === 1 ? '' : 's'}
                        </span>
                      ))}
                    </div>
                  )}
                  {(message.retrieval_trace.sources?.length ?? 0) > 0 && (
                    <div className="space-y-1">
                      {message.retrieval_trace.sources?.map((s) => (
                        <div key={s.id} className="flex items-center gap-2">
                          <div className="h-1 flex-1 overflow-hidden rounded-full bg-[var(--color-background-tertiary)]">
                            <div className="h-full rounded-full bg-[#7c3aed]" style={{ width: `${Math.max(4, Math.min(100, s.score * 100))}%` }} />
                          </div>
                          <span className="w-40 truncate text-[var(--color-text-secondary)]" title={s.label}>{s.label}</span>
                          <span className="w-9 text-right tabular-nums text-[var(--color-text-tertiary)]">{(s.score * 100).toFixed(0)}%</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {message.retrieval_trace.document_sources && message.retrieval_trace.document_sources.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {message.retrieval_trace.document_sources.map((s, i) => (
                        <span key={`${s.id}-${i}`} className="inline-flex items-center gap-1 rounded-full border border-[var(--color-border-tertiary)] bg-[var(--color-background-tertiary)] px-2 py-0.5 text-[10px] text-[var(--color-text-secondary)]" title={`${s.label} · ${(s.score * 100).toFixed(0)}% match`}>
                          <span className="text-[#16a34a]">📄</span><span className="max-w-[160px] truncate">{s.label || 'document'}</span>
                        </span>
                      ))}
                    </div>
                  )}
                  {/* Provenance: what the agent remembered + recalled (local, never left this machine) */}
                  {message.retrieval_trace.memory_sources && message.retrieval_trace.memory_sources.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {message.retrieval_trace.memory_sources.map((s, i) => (
                        <span key={`mem-${i}`} className="inline-flex items-center gap-1 rounded-full border border-[#7c3aed]/40 bg-[#7c3aed]/5 px-2 py-0.5 text-[10px] text-[var(--color-text-secondary)]" title={`memory (${s.kind})`}>
                          <span>{s.pinned ? '📌' : '🧠'}</span><span className="max-w-[180px] truncate">{s.preview}</span>
                        </span>
                      ))}
                    </div>
                  )}
                  {message.retrieval_trace.episode_sources && message.retrieval_trace.episode_sources.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {message.retrieval_trace.episode_sources.map((s, i) => (
                        <span key={`ep-${i}`} className="inline-flex items-center gap-1 rounded-full border border-[var(--color-border-tertiary)] bg-[var(--color-background-tertiary)] px-2 py-0.5 text-[10px] text-[var(--color-text-secondary)]" title="recalled from an earlier session">
                          <span className="text-[#0ea5e9]">↩</span><span className="max-w-[180px] truncate">{s.question}</span>
                        </span>
                      ))}
                    </div>
                  )}
                  <p className="text-[10px] text-[var(--color-text-tertiary)]">
                    ~{message.retrieval_trace.token_estimate} tokens of graph context injected · the neurosymbolic substrate cloud models don&apos;t have.
                  </p>
                </div>
              )}
              {/* Deliberation */}
              {message.deliberation && message.deliberation.candidates.length > 1 && (
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] uppercase tracking-wide text-[var(--color-text-secondary)]">Deliberation · best of {message.deliberation.candidates.length}</span>
                    {message.deliberation.critic && (
                      <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${
                        message.deliberation.critic.action === 'accept' ? 'bg-[#f0fdf4] text-[#15803d]' :
                        message.deliberation.critic.action === 'escalate' ? 'bg-[#fffbeb] text-[#b45309]' :
                        'bg-[#eff6ff] text-[#1d4ed8]'
                      }`}>{message.deliberation.critic.action}</span>
                    )}
                    {message.deliberation.critic && (
                      <span className="text-[10px] text-[var(--color-text-tertiary)]">agreement {(message.deliberation.critic.agreement * 100).toFixed(0)}%</span>
                    )}
                  </div>
                  {message.deliberation.critic?.reason && (
                    <p className="text-[10px] italic text-[var(--color-text-tertiary)]">{message.deliberation.critic.reason}</p>
                  )}
                  {message.deliberation.candidates.map((c) => (
                    <div key={c.rank} className={`flex items-center gap-2 rounded-lg px-2 py-1 ${c.rank === message.deliberation!.selected_rank ? 'bg-[rgba(37,99,235,0.1)]' : ''}`}>
                      <span className="w-10 shrink-0 text-[10px] text-[var(--color-text-tertiary)]">{c.rank === message.deliberation!.selected_rank ? '✓ best' : `#${c.rank + 1}`}</span>
                      <div className="h-1 flex-1 overflow-hidden rounded-full bg-[var(--color-background-tertiary)]">
                        <div className="h-full rounded-full bg-[#2563eb]" style={{ width: `${Math.max(4, c.worth * 100)}%` }} />
                      </div>
                      <span className="shrink-0 tabular-nums text-[10px] text-[var(--color-text-tertiary)]">
                        {(c.worth * 100).toFixed(0)}%{c.label ? ` · ${c.label.replace('esc:', '↑')}` : ` · T${c.temperature}`}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {/* Complexity discipline — posture/strategy/barriers for this turn */}
              {message.discipline && (
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
                    <span className="font-medium uppercase tracking-wide text-[var(--color-text-secondary)]">Discipline</span>
                    <span className="rounded-full bg-[var(--color-background-tertiary)] px-1.5 py-0.5 text-[var(--color-text-secondary)]">{message.discipline.posture}</span>
                    {message.discipline.strategy && (
                      <span className="text-[var(--color-text-tertiary)]">→ {message.discipline.strategy}</span>
                    )}
                    <span
                      className={`rounded-full px-1.5 py-0.5 font-semibold ${
                        message.discipline.calibrated_confidence >= 0.7 ? 'bg-[#f0fdf4] text-[#15803d]' :
                        message.discipline.calibrated_confidence < 0.3 ? 'bg-[#fef2f2] text-[#b91c1c]' :
                        'bg-[var(--color-background-tertiary)] text-[var(--color-text-tertiary)]'
                      }`}
                      title="Calibrated confidence — high = code-verified/grounded; low = speculative/barriers"
                    >
                      conf {(message.discipline.calibrated_confidence * 100).toFixed(0)}%
                    </span>
                  </div>
                  {message.discipline.barriers && message.discipline.barriers.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {message.discipline.barriers.map((b, i) => (
                        <span key={i} className="rounded-full border border-[#fca5a5] bg-[#fef2f2] px-1.5 py-0.5 text-[9px] text-[#b91c1c]">{b}</span>
                      ))}
                    </div>
                  )}
                  {message.discipline.non_claims && message.discipline.non_claims.length > 0 && (
                    <div className="text-[10px] italic text-[var(--color-text-tertiary)]">Non-claims: {message.discipline.non_claims.slice(0, 3).join(' · ')}</div>
                  )}
                </div>
              )}
              {message.steering_result ? <SteeringDiff result={message.steering_result} /> : null}
              {message.governance ? <GovernanceTrail trace={message.governance} /> : null}
            </div>
          </details>
        )}
      </div>
    </article>
  )
}
