'use client'

import { useState } from 'react'
import { GovernanceTrail } from '@/components/governance/GovernanceTrail'
import { SteeringDiff } from '@/components/steering/SteeringDiff'
import type { ChatMessage } from '@/lib/types/message'

type MessageBubbleProps = {
  message: ChatMessage
  onExtractArtifact?: (content: string, messageId: string) => void
}

export function MessageBubble({ message, onExtractArtifact }: MessageBubbleProps) {
  const isUser = message.role === 'user'
  const [extracted, setExtracted] = useState(false)

  if (isUser) {
    return (
      <article className="flex justify-end">
        <div className="max-w-[78%] space-y-1">
          {message.workspace_mode && message.workspace_mode !== 'Chat' && (
            <div className="flex justify-end">
              <span className="rounded-full bg-[#0f172a] px-2.5 py-0.5 text-[11px] font-semibold text-white">
                {message.workspace_mode}
              </span>
            </div>
          )}
          <div className="rounded-3xl bg-[#dbeafe] px-4 py-3 text-sm leading-6 text-[#0f172a] shadow-sm">
            <p className="whitespace-pre-wrap">{message.content}</p>
          </div>
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
    <article className="group flex gap-4">
      <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#0f172a] text-xs font-semibold text-white">
        N
      </div>
      <div className="min-w-0 flex-1 text-[#111827]">
        <p className="whitespace-pre-wrap text-[15px] leading-7">{message.content || ' '}</p>

        {/* Extract to artifact — shown on hover when there's content */}
        {message.content && onExtractArtifact && (
          <div className="mt-1.5 flex items-center gap-2 opacity-0 transition-opacity group-hover:opacity-100">
            <button
              onClick={handleExtract}
              className="flex items-center gap-1.5 rounded-lg border border-[#e2e8f0] bg-white px-2.5 py-1 text-[11px] font-medium text-[#64748b] shadow-sm transition hover:border-[#bfdbfe] hover:text-[#1d4ed8]"
            >
              <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden>
                <path d="M2 9h7M5.5 1v6M3 4.5l2.5-2.5 2.5 2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              {extracted ? 'Saved to Artifacts' : 'Save as artifact'}
            </button>
          </div>
        )}

        {message.steering_result ? <SteeringDiff result={message.steering_result} /> : null}
        {message.governance ? <GovernanceTrail trace={message.governance} /> : null}
      </div>
    </article>
  )
}
