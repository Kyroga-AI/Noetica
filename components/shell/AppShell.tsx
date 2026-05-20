'use client'

import { useMemo, useState } from 'react'
import { Sidebar } from '@/components/shell/Sidebar'
import { Topbar } from '@/components/shell/Topbar'
import { MessageList } from '@/components/chat/MessageList'
import { InputArea } from '@/components/chat/InputArea'
import { SteeringPanel } from '@/components/steering/SteeringPanel'
import { models, defaultModelId } from '@/config/models'
import { initialMessages } from '@/lib/chat/mockConversation'
import type { ChatMessage } from '@/lib/types/message'
import type { GovernanceTrace } from '@/lib/types/governance'
import type { SteeringConfig } from '@/lib/types/steering'

type StreamEvent = {
  event: string
  data: string
}

export function AppShell() {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages)
  const [modelId, setModelId] = useState(defaultModelId)
  const [mode, setMode] = useState<'standalone' | 'sourceos'>('standalone')
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
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          session_id: 'local-session',
          mode,
          model_id: modelId,
          messages: outboundMessages,
          steering,
          memory_scope: 'noetica-session-local'
        })
      })

      if (!response.ok || !response.body) {
        const payload = await response.json().catch(() => ({ error: 'unknown_route_error' }))
        updateAssistant(assistantId, { content: `Noetica route error: ${payload.error}` })
        return
      }

      await readEventStream(response, {
        onMeta: (governance) => updateAssistant(assistantId, { governance }),
        onDelta: (delta) => appendAssistantContent(assistantId, delta),
        onDone: (result) =>
          updateAssistant(assistantId, {
            content: result.content,
            governance: {
              run_id: result.run_id,
              model_routed: result.model_routed,
              provider: result.provider,
              policy_admitted: result.policy_admitted,
              memory_written: result.memory_written,
              request_hash: result.request_hash,
              evidence_hash: result.evidence_hash,
              provider_route_evidence: result.provider_route_evidence,
              timestamp: result.timestamp,
              latency_ms: result.latency_ms
            },
            steering_result: result.steering_applied
          }),
        onError: (error) => updateAssistant(assistantId, { content: `Noetica route error: ${error}` })
      })
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

async function readEventStream(
  response: Response,
  handlers: {
    onMeta: (governance: GovernanceTrace) => void
    onDelta: (delta: string) => void
    onDone: (result: StreamDoneResult) => void
    onError: (error: string) => void
  }
) {
  const reader = response.body?.getReader()
  if (!reader) return

  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const parts = buffer.split('\n\n')
    buffer = parts.pop() ?? ''

    for (const part of parts) {
      const parsed = parseSseEvent(part)
      if (!parsed) continue

      const payload = JSON.parse(parsed.data)
      if (parsed.event === 'meta') handlers.onMeta(payload.governance)
      if (parsed.event === 'delta') handlers.onDelta(payload.delta)
      if (parsed.event === 'done') handlers.onDone(payload.result)
      if (parsed.event === 'error') handlers.onError(payload.error)
    }
  }
}

function parseSseEvent(raw: string): StreamEvent | undefined {
  const lines = raw.split('\n')
  const event = lines.find((line) => line.startsWith('event:'))?.slice(6).trim()
  const data = lines.find((line) => line.startsWith('data:'))?.slice(5).trim()

  if (!event || !data) return undefined
  return { event, data }
}

type StreamDoneResult = {
  run_id: string
  content: string
  model_routed: string
  provider: string
  policy_admitted: boolean
  memory_written: boolean
  request_hash?: string
  evidence_hash?: string
  provider_route_evidence?: GovernanceTrace['provider_route_evidence']
  timestamp?: string
  latency_ms: number
  steering_applied?: ChatMessage['steering_result']
}
