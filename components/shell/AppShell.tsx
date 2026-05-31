'use client'

import { useMemo, useState } from 'react'
import { Sidebar } from '@/components/shell/Sidebar'
import { Topbar } from '@/components/shell/Topbar'
import { MessageList } from '@/components/chat/MessageList'
import { InputArea } from '@/components/chat/InputArea'
import { SteeringPanel } from '@/components/steering/SteeringPanel'
import { models, defaultModelId } from '@/config/models'
import { initialMessages } from '@/lib/chat/mockConversation'
import { sendNoeticaChat } from '@/lib/client/noeticaTransport'
import type { ChatMessage } from '@/lib/types/message'
import type { SteeringConfig } from '@/lib/types/steering'
import type { NoeticaMode } from '@/lib/client/noeticaTransport'

export function AppShell() {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages)
  const [modelId, setModelId] = useState(defaultModelId)
  const [mode, setMode] = useState<NoeticaMode>('standalone')
  const [steering, setSteering] = useState<SteeringConfig | undefined>()
  const [isStreaming, setIsStreaming] = useState(false)
  const activeModel = useMemo(
    () => models.find((model) => model.id === modelId) ?? models[0],
    [modelId]
  )

  async function handleSend(content: string) {
    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content,
      created_at: new Date().toISOString()
    }
    const assistantId = crypto.randomUUID()
    const assistantMessage: ChatMessage = {
      id: assistantId,
      role: 'assistant',
      content: '',
      created_at: new Date().toISOString()
    }
    const outboundMessages = [...messages, userMessage]

    setMessages((current) => [...current, userMessage, assistantMessage])
    setIsStreaming(true)

    try {
      await sendNoeticaChat(
        {
          session_id: 'local-session',
          mode,
          model_id: modelId,
          messages: outboundMessages,
          steering,
          memory_scope: 'noetica-session-local'
        },
        {
          onMeta: (governance) => updateAssistant(assistantId, { governance }),
          onDelta: (delta) => appendAssistantContent(assistantId, delta),
          onDone: (result) =>
            updateAssistant(assistantId, {
              content: result.content,
              governance: {
                run_id: result.run_id,
                model_routed: result.model_routed,
                provider: result.provider,
                model_overridden: result.model_overridden,
                policy_admitted: result.policy_admitted,
                policy_ref: result.policy_ref,
                memory_scope_ref: result.memory_scope_ref,
                memory_written: result.memory_written,
                evidence_ref: result.evidence_ref,
                replay_ref: result.replay_ref,
                agentplane_run_id: result.agentplane_run_id,
                request_hash: result.request_hash,
                evidence_hash: result.evidence_hash,
                provider_route_evidence: result.provider_route_evidence,
                grant_refs: result.grant_refs,
                sourceos_status: result.status,
                timestamp: result.timestamp,
                latency_ms: result.latency_ms
              },
              steering_result: result.steering_applied
            }),
          onError: (error) => updateAssistant(assistantId, { content: `Noetica route error: ${error}` })
        }
      )
    } finally {
      setIsStreaming(false)
    }
  }

  function updateAssistant(id: string, patch: Partial<ChatMessage>) {
    setMessages((current) => current.map((message) => (message.id === id ? { ...message, ...patch } : message)))
  }

  function appendAssistantContent(id: string, delta: string) {
    setMessages((current) =>
      current.map((message) =>
        message.id === id ? { ...message, content: `${message.content}${delta}` } : message
      )
    )
  }

  return (
    <main className="flex min-h-screen bg-white text-slate-950">
      <Sidebar />
      <section className="flex min-w-0 flex-1 flex-col">
        <Topbar modelId={modelId} mode={mode} onModeChange={setMode} onModelChange={setModelId} />
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-0 lg:grid-cols-[1fr_360px]">
          <section className="flex min-h-0 flex-col border-r border-noetica-line">
            <MessageList messages={messages} isStreaming={isStreaming} />
            <InputArea onSend={handleSend} disabled={isStreaming} />
          </section>
          <SteeringPanel model={activeModel} steering={steering} onChange={setSteering} />
        </div>
      </section>
    </main>
  )
}
