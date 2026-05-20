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
import type { SteeringConfig } from '@/lib/types/steering'

export function AppShell() {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages)
  const [modelId, setModelId] = useState(defaultModelId)
  const [mode, setMode] = useState<'standalone' | 'sourceos'>('standalone')
  const [steering, setSteering] = useState<SteeringConfig | undefined>()
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

    setMessages((current) => [...current, userMessage])

    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        session_id: 'local-session',
        mode,
        model_id: modelId,
        messages: [...messages, userMessage],
        steering,
        memory_scope: 'noetica-session-local'
      })
    })

    const payload = await response.json()

    const assistantMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: response.ok ? payload.result.content : `Noetica route error: ${payload.error}`,
      created_at: new Date().toISOString(),
      governance: response.ok
        ? {
            run_id: payload.result.run_id ?? crypto.randomUUID(),
            model_routed: payload.result.model_routed,
            provider: payload.result.provider,
            policy_admitted: payload.result.policy_admitted,
            memory_written: payload.result.memory_written,
            evidence_ref: payload.result.evidence_ref,
            latency_ms: payload.result.latency_ms
          }
        : undefined,
      steering_result: response.ok ? payload.result.steering_applied : undefined
    }

    setMessages((current) => [...current, assistantMessage])
  }

  return (
    <main className="flex min-h-screen bg-white text-slate-950">
      <Sidebar />
      <section className="flex min-w-0 flex-1 flex-col">
        <Topbar modelId={modelId} mode={mode} onModeChange={setMode} onModelChange={setModelId} />
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-0 lg:grid-cols-[1fr_360px]">
          <section className="flex min-h-0 flex-col border-r border-noetica-line">
            <MessageList messages={messages} />
            <InputArea onSend={handleSend} />
          </section>
          <SteeringPanel model={activeModel} steering={steering} onChange={setSteering} />
        </div>
      </section>
    </main>
  )
}
