import { GovernanceTrail } from '@/components/governance/GovernanceTrail'
import { SteeringDiff } from '@/components/steering/SteeringDiff'
import type { ChatMessage } from '@/lib/types/message'

type MessageBubbleProps = {
  message: ChatMessage
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === 'user'

  if (isUser) {
    return (
      <article className="flex justify-end">
        <div className="max-w-[78%] rounded-3xl bg-[#e9dfd2] px-4 py-3 text-sm leading-6 text-[#1f1b16] shadow-sm">
          <p className="whitespace-pre-wrap">{message.content}</p>
        </div>
      </article>
    )
  }

  return (
    <article className="flex gap-4">
      <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#2f261d] text-xs font-semibold text-[#f7f3ec]">
        N
      </div>
      <div className="min-w-0 flex-1 text-[#1f1b16]">
        <p className="whitespace-pre-wrap text-[15px] leading-7">{message.content || ' '}</p>
        {message.steering_result ? <SteeringDiff result={message.steering_result} /> : null}
        {message.governance ? <GovernanceTrail trace={message.governance} /> : null}
      </div>
    </article>
  )
}
