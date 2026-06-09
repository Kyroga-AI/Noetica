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

  return (
    <article className="flex gap-4">
      <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#0f172a] text-xs font-semibold text-white">
        N
      </div>
      <div className="min-w-0 flex-1 text-[#111827]">
        <p className="whitespace-pre-wrap text-[15px] leading-7">{message.content || ' '}</p>
        {message.steering_result ? <SteeringDiff result={message.steering_result} /> : null}
        {message.governance ? <GovernanceTrail trace={message.governance} /> : null}
      </div>
    </article>
  )
}
