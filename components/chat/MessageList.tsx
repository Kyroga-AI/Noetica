'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { MessageBubble } from '@/components/chat/MessageBubble'
import { TypingIndicator } from '@/components/chat/TypingIndicator'
import type { ChatMessage } from '@/lib/types/message'

type MessageListProps = {
  messages: ChatMessage[]
  isStreaming?: boolean
  onExtractArtifact?: (content: string, messageId: string) => void
  onRegenerate?: () => void
  onResume?: () => void
  onFork?: (messageId: string) => void
  onEdit?: (messageId: string, newContent: string) => void
  onRecombine?: (selectedMessages: ChatMessage[]) => void
  onSpeak?: (content: string) => void
  onOpenSurface?: (surface: string) => void
}

export function MessageList({ messages, isStreaming = false, onExtractArtifact, onRegenerate, onResume, onFork, onEdit, onRecombine, onSpeak, onOpenSurface }: MessageListProps) {
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
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-4 text-center">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--color-text-primary)] text-sm font-semibold text-[var(--color-background-primary)]">N</div>
        <div>
          <p className="text-base font-medium text-[var(--color-text-primary)]">How can I help you today?</p>
          <p className="mt-1 text-sm text-[var(--color-text-tertiary)]">Type / for commands</p>
        </div>
      </div>
    )
  }

  return (
    <div className="relative min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-8">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        {messages.map((message, i) => (
          <div key={message.id} className="relative">
            {hasFanout && message.fanout_model && (
              <label className="absolute -left-6 top-3 flex cursor-pointer items-center">
                <input
                  type="checkbox"
                  checked={selectedFanout.has(message.id)}
                  onChange={() => toggleFanout(message.id)}
                  className="h-3.5 w-3.5 rounded border-[#bfdbfe] accent-[#1d4ed8]"
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
              onOpenSurface={onOpenSurface}
            />
          </div>
        ))}
        {isStreaming ? <TypingIndicator /> : null}
        <div ref={bottomRef} />
      </div>

      {selectedFanout.size >= 2 && (
        <div className="sticky bottom-4 flex justify-center">
          <div className="flex items-center gap-3 rounded-2xl border border-[#bfdbfe] bg-[var(--color-background-primary)]/95 px-4 py-2.5 shadow-lg backdrop-blur">
            <span className="text-xs font-medium text-[var(--color-text-primary)]">{selectedFanout.size} responses selected</span>
            <button
              onClick={() => setSelectedFanout(new Set())}
              className="text-xs text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]"
            >
              Clear
            </button>
            <button
              onClick={handleSynthesize}
              className="rounded-full bg-[#1d4ed8] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#1e40af]"
            >
              Synthesize →
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
