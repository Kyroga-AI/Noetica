import { MessageBubble } from '@/components/chat/MessageBubble'
import { TypingIndicator } from '@/components/chat/TypingIndicator'
import type { ChatMessage } from '@/lib/types/message'

type MessageListProps = {
  messages: ChatMessage[]
  isStreaming?: boolean
}

export function MessageList({ messages, isStreaming = false }: MessageListProps) {
  return (
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-6">
      {messages.map((message) => (
        <MessageBubble key={message.id} message={message} />
      ))}
      {isStreaming ? <TypingIndicator /> : null}
    </div>
  )
}
