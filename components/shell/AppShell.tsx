'use client'

import { useMemo, useState } from 'react'
import { Sidebar } from '@/components/shell/Sidebar'
import { Topbar } from '@/components/shell/Topbar'
import { MessageList } from '@/components/chat/MessageList'
import { InputArea, type WorkspaceMode } from '@/components/chat/InputArea'
import { SteeringPanel } from '@/components/steering/SteeringPanel'
import { CoworkSurface } from '@/components/surfaces/CoworkSurface'
import { CodeSurface } from '@/components/surfaces/CodeSurface'
import { EvaluateSurface } from '@/components/surfaces/EvaluateSurface'
import { GovernSurface } from '@/components/surfaces/GovernSurface'
import { CoworkPanel } from '@/components/panels/CoworkPanel'
import { CodePanel } from '@/components/panels/CodePanel'
import { EvaluatePanel } from '@/components/panels/EvaluatePanel'
import { GovernPanel } from '@/components/panels/GovernPanel'
import { models, defaultModelId } from '@/config/models'
import { initialMessages } from '@/lib/chat/mockConversation'
import { sendNoeticaChat } from '@/lib/client/noeticaTransport'
import type { ChatMessage } from '@/lib/types/message'
import type { SteeringConfig } from '@/lib/types/steering'
import type { NoeticaMode } from '@/lib/client/noeticaTransport'
import type { ActiveSurface } from '@/lib/types/surface'
import type { ModelConfig } from '@/lib/types/model'

// Map left-rail surface to the composer WorkspaceMode used in requests
const surfaceToWorkspaceMode: Record<ActiveSurface, WorkspaceMode> = {
  chat: 'Chat',
  cowork: 'Cowork',
  code: 'Code',
  evaluate: 'Benchmark',
  govern: 'Chat'
}

export function AppShell() {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages)
  const [modelId, setModelId] = useState(defaultModelId)
  const [mode, setMode] = useState<NoeticaMode>('standalone')
  const [activeSurface, setActiveSurface] = useState<ActiveSurface>('chat')
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>('Chat')
  const [steering, setSteering] = useState<SteeringConfig | undefined>()
  const [isStreaming, setIsStreaming] = useState(false)
  const activeModel = useMemo(
    () => models.find((model) => model.id === modelId) ?? models[0],
    [modelId]
  )

  function handleSurfaceChange(surface: ActiveSurface) {
    setActiveSurface(surface)
    setWorkspaceMode(surfaceToWorkspaceMode[surface])
  }

  async function handleSend(content: string) {
    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content,
      workspace_mode: workspaceMode,
      created_at: new Date().toISOString()
    }
    const assistantId = crypto.randomUUID()
    const assistantMessage: ChatMessage = {
      id: assistantId,
      role: 'assistant',
      content: '',
      created_at: new Date().toISOString()
    }
    // Include workspace_mode as a prefix only in the outbound API payload, not in display content
    const outboundUserMessage: ChatMessage = {
      ...userMessage,
      content: workspaceMode !== 'Chat' ? `[${workspaceMode}] ${content}` : content
    }
    const outboundMessages = [...messages, outboundUserMessage]

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
          memory_scope: `noetica-session-local:${workspaceMode.toLowerCase()}`
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
    <main className="flex min-h-screen bg-[#f3f6fa] text-[#111827]">
      <Sidebar activeSurface={activeSurface} onSurfaceChange={handleSurfaceChange} />

      <section className="flex min-w-0 flex-1 flex-col">
        <Topbar modelId={modelId} mode={mode} onModeChange={setMode} onModelChange={setModelId} />

        <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_280px]">
          {/* Center workspace — switches per surface */}
          <CenterWorkspace
            activeSurface={activeSurface}
            messages={messages}
            isStreaming={isStreaming}
            workspaceMode={workspaceMode}
            onSend={handleSend}
            onWorkspaceModeChange={setWorkspaceMode}
          />

          {/* Right panel — contextual per surface */}
          <RightPanel
            activeSurface={activeSurface}
            model={activeModel}
            steering={steering}
            workspaceMode={workspaceMode}
            onSteeringChange={setSteering}
          />
        </div>
      </section>
    </main>
  )
}

// --- Sub-renderers (kept in this file to avoid prop-drilling explosion) ---

type CenterProps = {
  activeSurface: ActiveSurface
  messages: ChatMessage[]
  isStreaming: boolean
  workspaceMode: WorkspaceMode
  onSend: (content: string) => Promise<void>
  onWorkspaceModeChange: (mode: WorkspaceMode) => void
}

function CenterWorkspace({ activeSurface, messages, isStreaming, workspaceMode, onSend, onWorkspaceModeChange }: CenterProps) {
  if (activeSurface === 'cowork') return <CoworkSurface />
  if (activeSurface === 'code') return <CodeSurface />
  if (activeSurface === 'evaluate') return <EvaluateSurface />
  if (activeSurface === 'govern') return <GovernSurface />

  // Default: chat
  return (
    <section className="flex min-h-0 flex-col">
      <MessageList messages={messages} isStreaming={isStreaming} />
      <InputArea
        onSend={onSend}
        disabled={isStreaming}
        workspaceMode={workspaceMode}
        onWorkspaceModeChange={onWorkspaceModeChange}
      />
    </section>
  )
}

type RightPanelProps = {
  activeSurface: ActiveSurface
  model: ModelConfig
  steering: SteeringConfig | undefined
  workspaceMode: WorkspaceMode
  onSteeringChange: (config: SteeringConfig | undefined) => void
}

function RightPanel({ activeSurface, model, steering, workspaceMode, onSteeringChange }: RightPanelProps) {
  if (activeSurface === 'cowork') return <CoworkPanel />
  if (activeSurface === 'code') return <CodePanel />
  if (activeSurface === 'evaluate') return <EvaluatePanel />
  if (activeSurface === 'govern') return <GovernPanel />

  return (
    <SteeringPanel
      model={model}
      steering={steering}
      workspaceMode={workspaceMode}
      onChange={onSteeringChange}
    />
  )
}
