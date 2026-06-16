'use client'

import React, { useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
// eslint-disable-next-line
import oneLight from 'react-syntax-highlighter/dist/cjs/styles/prism/one-light'
// eslint-disable-next-line
import oneDark from 'react-syntax-highlighter/dist/cjs/styles/prism/one-dark'
import { GovernanceTrail } from '@/components/governance/GovernanceTrail'
import { SteeringDiff } from '@/components/steering/SteeringDiff'
import type { ChatMessage, ToolCallRecord, ToolResultRecord } from '@/lib/types/message'
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

function ToolCallCard({ call, result }: { call: ToolCallRecord; result?: ToolResultRecord }) {
  const [open, setOpen] = useState(false)
  const inputStr = JSON.stringify(call.input, null, 2)
  const isError = result?.result.startsWith('Error:')

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
  return (
    <div className="my-2">
      {calls.map((call) => (
        <ToolCallCard
          key={call.id}
          call={call}
          result={results?.find((r) => r.id === call.id)}
        />
      ))}
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
        // Links
        a: ({ href, children }) => (
          <a
            href={href}
            onClick={(e) => { e.preventDefault(); if (href) window.open(href, '_blank', 'noopener,noreferrer') }}
            className="text-[#1d4ed8] underline decoration-[#bfdbfe] hover:decoration-[#1d4ed8] transition-colors"
          >
            {children}
          </a>
        ),
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

type MessageBubbleProps = {
  message: ChatMessage
  isLast?: boolean
  onExtractArtifact?: (content: string, messageId: string) => void
  onRegenerate?: () => void
  onFork?: (messageId: string) => void
  onEdit?: (messageId: string, newContent: string) => void
}

export function MessageBubble({ message, isLast, onExtractArtifact, onRegenerate, onFork, onEdit }: MessageBubbleProps) {
  const isUser = message.role === 'user'
  const [extracted, setExtracted] = useState(false)
  const [copied, setCopied] = useState(false)
  const [editing, setEditing] = useState(false)
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

  return (
    <article className="group flex gap-3">
      <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--color-text-primary)] text-[9px] font-semibold text-[var(--color-background-primary)]">
        N
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-1 text-[11px] font-medium text-[var(--color-text-secondary)]">
          {message.fanout_model ?? 'Noetica'}
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

        {/* Tool calls */}
        {message.tool_calls && message.tool_calls.length > 0 && (
          <ToolCallList calls={message.tool_calls} results={message.tool_results} />
        )}

        {/* Main content — markdown rendered */}
        {message.content && <MarkdownContent content={message.content} />}

        {/* Streaming placeholder */}
        {!message.content && !message.tool_calls?.length && (
          <span className="inline-block h-4 w-4 animate-pulse rounded-sm bg-[var(--color-text-tertiary)]" />
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
          </div>
        )}

        {message.steering_result ? <SteeringDiff result={message.steering_result} /> : null}
        {message.governance ? <GovernanceTrail trace={message.governance} /> : null}
      </div>
    </article>
  )
}
