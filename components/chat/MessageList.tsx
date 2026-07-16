'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { MessageBubble } from '@/components/chat/MessageBubble'
import { TypingIndicator } from '@/components/chat/TypingIndicator'
import { BrandLockup } from '@/components/brand/NoeticaMark'
import type { ChatMessage } from '@/lib/types/message'
import { useSettings } from '@/lib/settings/context'
import { useUiStore } from '@/lib/store/uiStore'

type MessageListProps = {
  messages: ChatMessage[]
  isStreaming?: boolean
  mode?: 'standalone' | 'sourceos'
  onExtractArtifact?: (content: string, messageId: string) => void
  onRegenerate?: () => void
  onResume?: () => void
  onFork?: (messageId: string) => void
  onEdit?: (messageId: string, newContent: string) => void
  onRecombine?: (selectedMessages: ChatMessage[]) => void
  onSpeak?: (content: string) => void
  onQuickPrompt?: (text: string) => void
  onFeedback?: (messageId: string, rating: 'up' | 'down') => void
  onPlanApprove?: (messageId: string) => void
  onPlanReject?: (messageId: string) => void
}

export function MessageList({ messages, isStreaming = false, mode, onExtractArtifact, onRegenerate, onResume, onFork, onEdit, onRecombine, onSpeak, onQuickPrompt, onFeedback, onPlanApprove, onPlanReject }: MessageListProps) {
  const { settings } = useSettings()
  const privateSessionOn = useUiStore((s) => s.privateSessionOn)
  const lastAssistantIdx = messages.reduce((acc, m, i) => m.role === 'assistant' ? i : acc, -1)
  const [selectedFanout, setSelectedFanout] = useState<Set<string>>(new Set())
  const bottomRef = useRef<HTMLDivElement>(null)
  const initialScrollDone = useRef(false)

  // Instant scroll on first render (session restore) — smooth during live streaming
  useLayoutEffect(() => {
    if (!initialScrollDone.current && messages.length > 0) {
      bottomRef.current?.scrollIntoView({ behavior: 'instant' })
      initialScrollDone.current = true
    }
  }, [messages.length])

  useEffect(() => {
    if (initialScrollDone.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages.length, isStreaming])

  const fanoutIds = new Set(messages.filter((m) => m.fanout_model).map((m) => m.id))
  const hasFanout = fanoutIds.size > 1

  function toggleFanout(id: string) {
    setSelectedFanout((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function handleSynthesize() {
    if (!onRecombine) return
    const selected = messages.filter((m) => selectedFanout.has(m.id))
    setSelectedFanout(new Set())
    onRecombine(selected)
  }

  if (messages.length === 0) {
    const hour = new Date().getHours()
    // No "Good night" — if they're here they're awake; late hours read as evening, not a farewell.
    const greeting = hour < 5 ? 'Good evening' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
    const quickActions = [
      { label: 'Show my files', prompt: 'show my files', color: '#0891b2',
        icon: <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h2.8l1.2 1.5h5A1.5 1.5 0 0 1 14 6v6a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 12V4.5Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/></svg> },
      { label: 'Write code', prompt: 'write code', color: '#7c3aed',
        icon: <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M6 4 2.5 8 6 12M10 4l3.5 4-3.5 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg> },
      { label: 'Research', prompt: 'research: what is in my knowledge base?', color: '#ea580c',
        icon: <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="7" cy="7" r="4.2" stroke="currentColor" strokeWidth="1.4"/><path d="m10.5 10.5 3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg> },
      { label: 'Chart data', prompt: 'make a chart from this data: Jan 120, Feb 150, Mar 135, Apr 190', color: '#16a34a',
        icon: <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M2 14V2M2 14h12M5 11V8M8 11V5M11 11V7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg> },
      { label: 'What can you do?', prompt: 'What can you do?', color: '#d97706',
        icon: <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 1.5v3M8 11.5v3M1.5 8h3M11.5 8h3M3.5 3.5l2 2M10.5 10.5l2 2M12.5 3.5l-2 2M5.5 10.5l-2 2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg> },
    ]
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-6 px-4 text-center">
        {privateSessionOn && <PrivateSessionBanner />}
        <div className="flex items-center gap-3">
          <BrandLockup size={36} mode={mode} ringColor="var(--paper)" />
          <h1 className="text-2xl font-extrabold tracking-tight" style={{ color: 'var(--ink)' }}>{greeting}{settings.userName ? `, ${settings.userName}` : ''}</h1>
        </div>
        <p className="-mt-3 text-[13px]" style={{ color: 'var(--ink3)' }}>Local-first · your data never leaves this device</p>
        {onQuickPrompt && (
          <div className="flex flex-wrap items-center justify-center gap-2">
            {quickActions.map((a) => (
              <button
                key={a.label}
                onClick={() => onQuickPrompt(a.prompt)}
                className="flex items-center gap-1.5 rounded-full border border-[var(--color-border-tertiary)] bg-[var(--color-background-secondary)] px-3.5 py-1.5 text-[13px] text-[var(--color-text-secondary)] transition hover:border-[var(--color-border-secondary)] hover:text-[var(--color-text-primary)]"
              >
                <span style={{ color: a.color }}>{a.icon}</span>
                {a.label}
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="relative min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-8">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        {privateSessionOn && <PrivateSessionBanner />}
        {messages.map((message, i) => (
          <div key={message.id} className="relative">
            {hasFanout && message.fanout_model && (
              <label className="absolute -left-6 top-3 flex cursor-pointer items-center">
                <input
                  type="checkbox"
                  checked={selectedFanout.has(message.id)}
                  onChange={() => toggleFanout(message.id)}
                  className="h-3.5 w-3.5 rounded"
                  style={{ borderColor: 'var(--accent)', accentColor: 'var(--accent)' }}
                />
              </label>
            )}
            <MessageBubble
              message={message}
              isLast={i === lastAssistantIdx && !isStreaming}
              onExtractArtifact={onExtractArtifact}
              onRegenerate={i === lastAssistantIdx && !isStreaming ? onRegenerate : undefined}
              onResume={i === lastAssistantIdx && !isStreaming ? onResume : undefined}
              onFork={onFork}
              onEdit={message.role === 'user' ? onEdit : undefined}
              onSpeak={message.role === 'assistant' ? onSpeak : undefined}
              onQuickPrompt={onQuickPrompt}
              onFeedback={message.role === 'assistant' ? onFeedback : undefined}
              onPlanApprove={message.role === 'assistant' ? onPlanApprove : undefined}
              onPlanReject={message.role === 'assistant' ? onPlanReject : undefined}
            />
          </div>
        ))}
        {isStreaming ? <TypingIndicator /> : null}
        <div ref={bottomRef} />
      </div>

      {selectedFanout.size >= 2 && (
        <div className="sticky bottom-4 flex justify-center">
          <div className="flex items-center gap-3 rounded-2xl bg-[var(--color-background-primary)]/95 px-4 py-2.5 shadow-lg backdrop-blur" style={{ border: '1px solid var(--accent)' }}>
            <span className="text-xs font-medium text-[var(--color-text-primary)]">{selectedFanout.size} responses selected</span>
            <button
              onClick={() => setSelectedFanout(new Set())}
              className="text-xs text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]"
            >
              Clear
            </button>
            <button
              onClick={handleSynthesize}
              className="rounded-full px-3 py-1.5 text-xs font-semibold text-white"
              style={{ background: 'var(--accent)' }}
            >
              Synthesize →
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function PrivateSessionBanner() {
  // Backed by the real securityEphemeralMinutes/obliterateNow mechanism (see AppShell.tsx) —
  // read the actual configured TTL rather than hardcoding copy that could drift from it.
  const { settings } = useSettings()
  const minutes = settings.securityEphemeralMinutes ?? 30
  return (
    <div
      className="mx-auto flex w-full max-w-3xl items-center gap-2.5 rounded-xl px-4 py-2.5"
      style={{ background: 'var(--violet-soft)', borderLeft: '3px solid var(--violet)' }}
    >
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: 'var(--violet)', animation: 'pulseDot 1.6s infinite' }} />
      <span className="text-[12.5px]" style={{ color: 'var(--violet-fg)' }}>
        Private session — this conversation is ephemeral and deletes automatically after {minutes} minutes.
      </span>
    </div>
  )
}
