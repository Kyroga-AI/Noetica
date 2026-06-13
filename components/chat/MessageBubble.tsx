'use client'

import { useRef, useState } from 'react'
import { GovernanceTrail } from '@/components/governance/GovernanceTrail'
import { SteeringDiff } from '@/components/steering/SteeringDiff'
import type { ChatMessage } from '@/lib/types/message'
import type { PendingAttachment } from '@/lib/types/attachment'

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
        <div
          key={a.clientId}
          className="flex items-center gap-1.5 rounded-xl border border-[#93c5fd] bg-[#eff6ff] px-2.5 py-1.5 text-xs"
        >
          {a.kind === 'image' ? (
            <img
              src={`data:${a.mimeType};base64,${a.base64}`}
              alt={a.name}
              className="h-8 w-8 rounded-lg object-cover"
            />
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
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    onEdit?.(message.id, editContent.trim())
                    setEditing(false)
                  }
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
        {message.fanout_model && (
          <div className="mb-1.5 inline-flex items-center gap-1.5 rounded-md border border-[var(--color-border-tertiary)] bg-[var(--color-background-secondary)] px-2 py-0.5 text-[10px] text-[var(--color-text-secondary)]">
            {message.fanout_model}
          </div>
        )}
        {message.thinking && (
          <details className="mb-3 rounded-xl border border-[var(--color-border-tertiary)] bg-[var(--color-background-secondary)]">
            <summary className="cursor-pointer select-none px-3 py-2 text-xs font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]">
              Extended thinking
            </summary>
            <p className="px-3 pb-3 pt-1 whitespace-pre-wrap text-xs leading-6 text-[var(--color-text-secondary)]">{message.thinking}</p>
          </details>
        )}
        <p className="whitespace-pre-wrap text-[14px] leading-[1.75] text-[var(--color-text-primary)]">{message.content || ' '}</p>

        {/* Action bar — shown on hover when there's content */}
        {message.content && (
          <div className="mt-1.5 flex items-center gap-2 opacity-0 transition-opacity group-hover:opacity-100">
            <button
              onClick={handleCopy}
              className="flex items-center gap-1 rounded px-1.5 py-1 text-[11px] text-[var(--color-text-tertiary)] transition hover:text-[var(--color-text-secondary)]"
            >
              <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden>
                <rect x="1" y="3" width="6" height="7" rx="1" stroke="currentColor" strokeWidth="1.3"/>
                <path d="M3.5 3V2a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
              </svg>
              {copied ? 'Copied' : 'Copy'}
            </button>
            {onExtractArtifact && (
              <button
                onClick={handleExtract}
                className="flex items-center gap-1 rounded px-1.5 py-1 text-[11px] text-[var(--color-text-tertiary)] transition hover:text-[var(--color-text-secondary)]"
              >
                <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden>
                  <path d="M2 9h7M5.5 1v6M3 4.5l2.5-2.5 2.5 2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                {extracted ? 'Saved' : 'Save as artifact'}
              </button>
            )}
            {isLast && onRegenerate && (
              <button
                onClick={onRegenerate}
                className="flex items-center gap-1 rounded px-1.5 py-1 text-[11px] text-[var(--color-text-tertiary)] transition hover:text-[var(--color-text-secondary)]"
              >
                <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden>
                  <path d="M1.5 5.5A4 4 0 0 1 9 3M9.5 5.5A4 4 0 0 1 2 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                  <path d="M9 1.5v2h-2M2 9.5v-2h2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                Regenerate
              </button>
            )}
            {onFork && (
              <button
                onClick={() => onFork(message.id)}
                className="flex items-center gap-1 rounded px-1.5 py-1 text-[11px] text-[var(--color-text-tertiary)] transition hover:text-[var(--color-text-secondary)]"
              >
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
