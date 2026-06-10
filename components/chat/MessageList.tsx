import { MessageBubble } from '@/components/chat/MessageBubble'
import { TypingIndicator } from '@/components/chat/TypingIndicator'
import type { ChatMessage } from '@/lib/types/message'

type MessageListProps = {
  messages: ChatMessage[]
  isStreaming?: boolean
  onExtractArtifact?: (content: string, messageId: string) => void
}

export function MessageList({ messages, isStreaming = false, onExtractArtifact }: MessageListProps) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-8 sm:px-8">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
        {messages.map((message) => (
          <MessageBubble
            key={message.id}
            message={message}
            onExtractArtifact={onExtractArtifact}
          />
        ))}
        {isStreaming ? <TypingIndicator /> : null}
      </div>
    </div>
  )
}
