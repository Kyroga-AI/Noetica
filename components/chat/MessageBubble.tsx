import { GovernanceTrail } from '@/components/governance/GovernanceTrail'
import { SteeringDiff } from '@/components/steering/SteeringDiff'
import type { ChatMessage } from '@/lib/types/message'

type MessageBubbleProps = {
  message: ChatMessage
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === 'user'

  return (
    <article className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-3xl rounded-2xl border px-4 py-3 shadow-sm ${
          isUser
            ? 'border-blue-600 bg-blue-600 text-white'
            : 'border-blue-100 bg-white text-slate-900'
        }`}
      >
        <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] opacity-70">{message.role}</div>
        <p className="whitespace-pre-wrap text-sm leading-6">{message.content}</p>
        {message.steering_result ? <SteeringDiff result={message.steering_result} /> : null}
        {message.governance ? <GovernanceTrail trace={message.governance} /> : null}
      </div>
    </article>
  )
}
