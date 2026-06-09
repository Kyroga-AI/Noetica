'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
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
import { SettingsModal } from '@/components/settings/SettingsModal'
import { CommandPalette } from '@/components/palette/CommandPalette'
import { models, defaultModelId } from '@/config/models'
import { initialMessages } from '@/lib/chat/mockConversation'
import { sendNoeticaChat } from '@/lib/client/noeticaTransport'
import { listenTauri } from '@/lib/tauri/bridge'
import type { ChatMessage } from '@/lib/types/message'
import type { SteeringConfig } from '@/lib/types/steering'
import type { NoeticaMode } from '@/lib/client/noeticaTransport'
import type { ActiveSurface } from '@/lib/types/surface'
import type { ModelConfig } from '@/lib/types/model'

const surfaceToWorkspaceMode: Record<ActiveSurface, WorkspaceMode> = {
  chat: 'Chat',
  cowork: 'Cowork',
  code: 'Code',
  evaluate: 'Benchmark',
  govern: 'Chat',
}

export function AppShell() {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages)
  const [modelId, setModelId] = useState(defaultModelId)
  const [mode, setMode] = useState<NoeticaMode>('standalone')
  const [activeSurface, setActiveSurface] = useState<ActiveSurface>('chat')
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>('Chat')
  const [steering, setSteering] = useState<SteeringConfig | undefined>()
  const [isStreaming, setIsStreaming] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [inspectorVisible, setInspectorVisible] = useState(true)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsCategory, setSettingsCategory] = useState('appearance')
  const [paletteOpen, setPaletteOpen] = useState(false)

  const activeModel = useMemo(
    () => models.find((m) => m.id === modelId) ?? models[0],
    [modelId]
  )

  // --- Tauri menu event bridge ---
  useEffect(() => {
    let unlisten: (() => void) | undefined
    listenTauri('noetica:menu', (id) => {
      switch (id) {
        case 'settings':      openSettings(); break
        case 'new_chat':      handleNewChat(); break
        case 'command_palette': setPaletteOpen(true); break
        case 'toggle_sidebar':  setSidebarCollapsed((c) => !c); break
        case 'toggle_inspector': setInspectorVisible((v) => !v); break
      }
    }).then((fn) => { unlisten = fn })
    return () => unlisten?.()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // --- Keyboard shortcuts (browser + Tauri webview) ---
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey
      if (!mod) return
      if (e.key === 'k' || e.key === 'K') { e.preventDefault(); setPaletteOpen(true) }
      if (e.key === ',')                   { e.preventDefault(); openSettings() }
      if (e.key === 'n' || e.key === 'N') { e.preventDefault(); handleNewChat() }
      if (e.key === '\\')                  { e.preventDefault(); setSidebarCollapsed((c) => !c) }
      if (e.key === 'i' || e.key === 'I') { e.preventDefault(); setInspectorVisible((v) => !v) }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function openSettings(category = 'appearance') {
    setSettingsCategory(category)
    setSettingsOpen(true)
  }

  function handleNewChat() {
    setMessages(initialMessages)
    setActiveSurface('chat')
    setWorkspaceMode('Chat')
  }

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
      created_at: new Date().toISOString(),
    }
    const assistantId = crypto.randomUUID()
    const assistantMessage: ChatMessage = {
      id: assistantId,
      role: 'assistant',
      content: '',
      created_at: new Date().toISOString(),
    }
    const outboundUserMessage: ChatMessage = {
      ...userMessage,
      content: workspaceMode !== 'Chat' ? `[${workspaceMode}] ${content}` : content,
    }

    setMessages((current) => [...current, userMessage, assistantMessage])
    setIsStreaming(true)

    try {
      await sendNoeticaChat(
        {
          session_id: 'local-session',
          mode,
          model_id: modelId,
          messages: [...messages, outboundUserMessage],
          steering,
          memory_scope: `noetica-session-local:${workspaceMode.toLowerCase()}`,
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
                latency_ms: result.latency_ms,
              },
              steering_result: result.steering_applied,
            }),
          onError: (error) =>
            updateAssistant(assistantId, { content: `Noetica route error: ${error}` }),
        }
      )
    } finally {
      setIsStreaming(false)
    }
  }

  function updateAssistant(id: string, patch: Partial<ChatMessage>) {
    setMessages((current) =>
      current.map((m) => (m.id === id ? { ...m, ...patch } : m))
    )
  }

  function appendAssistantContent(id: string, delta: string) {
    setMessages((current) =>
      current.map((m) => (m.id === id ? { ...m, content: `${m.content}${delta}` } : m))
    )
  }

  return (
    <>
      <main className="flex min-h-screen bg-[#f3f6fa] text-[#111827]">
        {!sidebarCollapsed && (
          <Sidebar
            activeSurface={activeSurface}
            onSurfaceChange={handleSurfaceChange}
            onOpenSettings={() => openSettings()}
          />
        )}
        {sidebarCollapsed && (
          <CollapsedRail
            activeSurface={activeSurface}
            onSurfaceChange={handleSurfaceChange}
            onExpand={() => setSidebarCollapsed(false)}
          />
        )}

        <section className="flex min-w-0 flex-1 flex-col">
          <Topbar
            modelId={modelId}
            mode={mode}
            onModeChange={setMode}
            onModelChange={setModelId}
            onOpenSettings={() => openSettings()}
            onOpenPalette={() => setPaletteOpen(true)}
          />

          <div
            className={`grid min-h-0 flex-1 ${
              inspectorVisible
                ? 'grid-cols-1 lg:grid-cols-[minmax(0,1fr)_280px]'
                : 'grid-cols-1'
            }`}
          >
            <CenterWorkspace
              activeSurface={activeSurface}
              messages={messages}
              isStreaming={isStreaming}
              workspaceMode={workspaceMode}
              onSend={handleSend}
              onWorkspaceModeChange={setWorkspaceMode}
            />

            {inspectorVisible && (
              <RightPanel
                activeSurface={activeSurface}
                model={activeModel}
                steering={steering}
                workspaceMode={workspaceMode}
                onSteeringChange={setSteering}
              />
            )}
          </div>
        </section>
      </main>

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        initialCategory={settingsCategory}
      />

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onNewChat={handleNewChat}
        onOpenSettings={openSettings}
        onSwitchSurface={handleSurfaceChange}
        onToggleSidebar={() => setSidebarCollapsed((c) => !c)}
        onToggleInspector={() => setInspectorVisible((v) => !v)}
      />
    </>
  )
}

// --- Collapsed icon-only sidebar ---

type CollapsedRailProps = {
  activeSurface: ActiveSurface
  onSurfaceChange: (s: ActiveSurface) => void
  onExpand: () => void
}

const surfaceIcons: { id: ActiveSurface; label: string; icon: string }[] = [
  { id: 'chat',     label: 'Chat',     icon: '💬' },
  { id: 'cowork',   label: 'Cowork',   icon: '👥' },
  { id: 'code',     label: 'Code',     icon: '⌥'  },
  { id: 'evaluate', label: 'Evaluate', icon: '📊' },
  { id: 'govern',   label: 'Govern',   icon: '🛡' },
]

function CollapsedRail({ activeSurface, onSurfaceChange, onExpand }: CollapsedRailProps) {
  return (
    <aside className="hidden w-14 shrink-0 flex-col items-center border-r border-[#d7dee8] bg-[#eaf1f8] py-3 lg:flex">
      <button
        onClick={onExpand}
        className="mb-3 flex h-8 w-8 items-center justify-center rounded-lg text-[#64748b] transition hover:bg-white hover:text-[#0f172a]"
        title="Expand sidebar"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
          <path d="M5 3l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <nav className="flex flex-1 flex-col items-center gap-1">
        {surfaceIcons.map(({ id, label, icon }) => (
          <button
            key={id}
            onClick={() => onSurfaceChange(id)}
            title={label}
            className={`flex h-9 w-9 items-center justify-center rounded-xl text-sm transition ${
              activeSurface === id
                ? 'bg-[#dbeafe] text-[#0f172a]'
                : 'text-[#64748b] hover:bg-white hover:text-[#0f172a]'
            }`}
          >
            {icon}
          </button>
        ))}
      </nav>
    </aside>
  )
}

// --- Center workspace ---

type CenterProps = {
  activeSurface: ActiveSurface
  messages: ChatMessage[]
  isStreaming: boolean
  workspaceMode: WorkspaceMode
  onSend: (content: string) => Promise<void>
  onWorkspaceModeChange: (mode: WorkspaceMode) => void
}

function CenterWorkspace({ activeSurface, messages, isStreaming, workspaceMode, onSend, onWorkspaceModeChange }: CenterProps) {
  if (activeSurface === 'cowork')   return <CoworkSurface />
  if (activeSurface === 'code')     return <CodeSurface />
  if (activeSurface === 'evaluate') return <EvaluateSurface />
  if (activeSurface === 'govern')   return <GovernSurface />

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

// --- Right panel ---

type RightPanelProps = {
  activeSurface: ActiveSurface
  model: ModelConfig
  steering: SteeringConfig | undefined
  workspaceMode: WorkspaceMode
  onSteeringChange: (config: SteeringConfig | undefined) => void
}

function RightPanel({ activeSurface, model, steering, workspaceMode, onSteeringChange }: RightPanelProps) {
  if (activeSurface === 'cowork')   return <CoworkPanel />
  if (activeSurface === 'code')     return <CodePanel />
  if (activeSurface === 'evaluate') return <EvaluatePanel />
  if (activeSurface === 'govern')   return <GovernPanel />

  return (
    <SteeringPanel
      model={model}
      steering={steering}
      workspaceMode={workspaceMode}
      onChange={onSteeringChange}
    />
  )
}
