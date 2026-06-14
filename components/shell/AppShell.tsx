'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Sidebar } from '@/components/shell/Sidebar'
import { Topbar } from '@/components/shell/Topbar'
import { MessageList } from '@/components/chat/MessageList'
import { InputArea, type WorkspaceMode } from '@/components/chat/InputArea'
import { SteeringPanel } from '@/components/steering/SteeringPanel'
import { NotesSurface } from '@/components/surfaces/NotesSurface'
import { WorkroomsSurface } from '@/components/surfaces/WorkroomsSurface'
import { CoworkSurface } from '@/components/surfaces/CoworkSurface'
import { CodeSurface } from '@/components/surfaces/CodeSurface'
import { EvaluateSurface } from '@/components/surfaces/EvaluateSurface'
import { GovernSurface } from '@/components/surfaces/GovernSurface'
import { ProjectsSurface } from '@/components/surfaces/ProjectsSurface'
import { ArtifactsSurface } from '@/components/surfaces/ArtifactsSurface'
import { OperateSurface } from '@/components/surfaces/OperateSurface'
import { TuneSurface } from '@/components/surfaces/TuneSurface'
import { CoworkPanel } from '@/components/panels/CoworkPanel'
import { CodePanel } from '@/components/panels/CodePanel'
import { EvaluatePanel } from '@/components/panels/EvaluatePanel'
import { GovernPanel } from '@/components/panels/GovernPanel'
import { SettingsModal } from '@/components/settings/SettingsModal'
import { CommandPalette } from '@/components/palette/CommandPalette'
import { models, defaultModelId } from '@/config/models'
import { initialMessages } from '@/lib/chat/mockConversation'
import { sendNoeticaChat } from '@/lib/client/noeticaTransport'
import { buildRiskAversionLiveReadout } from '@/lib/risk/riskAversionLive'
import { listenTauri } from '@/lib/tauri/bridge'
import { useSession } from '@/lib/session/useSession'
import { useArtifacts } from '@/lib/artifacts/useArtifacts'
import { useMcp } from '@/lib/mcp/useMcp'
import { useSettings } from '@/lib/settings/context'
import { useVoice } from '@/lib/voice/useVoice'
import { RightSidebar } from '@/components/shell/RightSidebar'
import { UtilityRail, type UtilityPanelId } from '@/components/rail/UtilityRail'
import { RuntimeStatus } from '@/components/status/RuntimeStatus'
import type { PendingAttachment } from '@/lib/types/attachment'
import type { McpTool } from '@/lib/types/mcp'
import type { ChatMessage } from '@/lib/types/message'
import type { SteeringConfig } from '@/lib/types/steering'
import type { NoeticaMode } from '@/lib/client/noeticaTransport'
import type { ActiveSurface } from '@/lib/types/surface'
import type { ModelConfig } from '@/lib/types/model'
import type { GovernanceTrace } from '@/lib/types/governance'

const SURFACE_ORDER: ActiveSurface[] = ['chat', 'notes', 'workrooms', 'cowork', 'projects', 'artifacts', 'code', 'evaluate', 'operate']

const surfaceToWorkspaceMode: Record<ActiveSurface, WorkspaceMode> = {
  chat:         'Chat',
  notes:        'Chat',
  workrooms:    'Cowork',
  cowork:       'Cowork',
  projects:     'Cowork',
  artifacts:    'Chat',
  code:         'Code',
  evaluate:     'Benchmark',
  operate:      'Chat',
  govern:       'Chat',
  tune:         'Chat',
  holographme:  'Chat',
  marketplace:  'Chat',
}

export function AppShell() {
  // ── Session persistence ────────────────────────────────────────────────────
  const {
    hydrated,
    activeSession,
    sessions,
    newSession,
    switchSession,
    removeSession,
    updateMessages,
    updateSurface,
    updateModelId,
    updateTitle,
  } = useSession(defaultModelId)

  // ── Derive surface / messages from active session (with local overrides) ──
  const [activeSurface, setActiveSurface] = useState<ActiveSurface>('chat')
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>('Chat')
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages)
  const [modelId, setModelId] = useState(defaultModelId)

  // Hydrate local state from restored session once on mount
  useEffect(() => {
    if (!hydrated) return
    if (activeSession) {
      setActiveSurface(activeSession.surface)
      setWorkspaceMode(activeSession.workspaceMode)
      setMessages(activeSession.messages.length > 0 ? activeSession.messages : initialMessages)
      setModelId(activeSession.modelId)
    } else {
      // No saved session — create one for the current initial state
      newSession({ surface: 'chat', workspaceMode: 'Chat', messages: initialMessages })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated])

  // ── Settings (provider keys, runtime mode) ───────────────────────────────
  const { settings } = useSettings()

  // ── MCP ───────────────────────────────────────────────────────────────────
  const { tools: mcpTools } = useMcp()

  // ── Artifacts ─────────────────────────────────────────────────────────────
  const { createArtifact } = useArtifacts()

  function handleExtractArtifact(content: string, messageId: string) {
    // Auto-detect type: HTML if starts with <, code block if has ``` fence, else document
    const trimmed = content.trim()
    const isHtml = trimmed.startsWith('<') && trimmed.includes('</')
    const codeMatch = trimmed.match(/^```(\w+)?\n([\s\S]+?)```/)
    if (isHtml) {
      createArtifact({ type: 'html', title: 'HTML artifact', content: trimmed, messageId })
    } else if (codeMatch) {
      const lang = codeMatch[1] ?? 'other'
      createArtifact({ type: 'code', title: `Code — ${lang}`, language: lang, content: codeMatch[2], messageId })
    } else {
      createArtifact({ type: 'document', title: content.slice(0, 50).trim() || 'Document', content: trimmed, messageId })
    }
  }

  // ── Shell state ────────────────────────────────────────────────────────────
  const [mode, setMode] = useState<NoeticaMode>('standalone')
  const [steering, setSteering] = useState<SteeringConfig | undefined>()
  const [thinkingBudget, setThinkingBudget] = useState<number | undefined>()
  const [isStreaming, setIsStreaming] = useState(false)
  const abortControllerRef = useRef<AbortController | null>(null)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [rightSidebarCollapsed, setRightSidebarCollapsed] = useState(false)
  const [utilityPanel, setUtilityPanel] = useState<UtilityPanelId | null>(null)
  const [inspectorVisible, setInspectorVisible] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsCategory, setSettingsCategory] = useState('appearance')
  const [paletteOpen, setPaletteOpen] = useState(false)

  const activeModel = useMemo(
    () => models.find((m) => m.id === modelId) ?? models[0],
    [modelId]
  )
  const riskReadout = useMemo(() => buildRiskAversionLiveReadout(messages), [messages])
  const lastGovernance = useMemo<GovernanceTrace | undefined>(
    () => [...messages].reverse().find((m) => m.governance !== undefined)?.governance,
    [messages]
  )
  const fanoutModelCount = Math.min(settings.fanoutModels.length, settings.fanoutConcurrency)

  const { state: voiceState, startListening, stopListening } = useVoice((transcript) => {
    void handleSendRaw(transcript, [], messages)
  })

  // ── Tauri menu bridge ──────────────────────────────────────────────────────
  useEffect(() => {
    let unlisten: (() => void) | undefined
    listenTauri('noetica:menu', (id) => {
      switch (id) {
        case 'settings':         openSettings(); break
        case 'new_chat':         handleNewChat(); break
        case 'command_palette':  setPaletteOpen(true); break
        case 'toggle_sidebar':   setSidebarCollapsed((c) => !c); break
        case 'toggle_inspector': setInspectorVisible((v) => !v); break
      }
    }).then((fn) => { unlisten = fn })
    return () => unlisten?.()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Apply appearance settings to document ─────────────────────────────────
  useEffect(() => {
    const sizes: Record<string, string> = { sm: 'sm', md: 'md', lg: 'lg' }
    document.documentElement.setAttribute('data-font-size', sizes[settings.fontSize] ?? 'md')
  }, [settings.fontSize])

  // ── Keyboard shortcuts ─────────────────────────────────────────────────────
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey
      if (!mod) return
      if (e.key === 'k' || e.key === 'K') { e.preventDefault(); setPaletteOpen(true) }
      if (e.key === ',')                   { e.preventDefault(); openSettings() }
      if (e.key === 'n' || e.key === 'N') { e.preventDefault(); handleNewChat() }
      if (e.key === '\\')                  { e.preventDefault(); setSidebarCollapsed((c) => !c) }
      if (e.key === 'i' || e.key === 'I') { e.preventDefault(); setInspectorVisible((v) => !v) }
      const digit = parseInt(e.key, 10)
      if (digit >= 1 && digit <= 9 && SURFACE_ORDER[digit - 1]) {
        e.preventDefault()
        handleSurfaceChange(SURFACE_ORDER[digit - 1])
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Actions ────────────────────────────────────────────────────────────────

  function openSettings(category = 'appearance') {
    setSettingsCategory(category)
    setSettingsOpen(true)
  }

  function handleNewChat() {
    const msgs = initialMessages
    setMessages(msgs)
    setActiveSurface('chat')
    setWorkspaceMode('Chat')
    newSession({ surface: 'chat', workspaceMode: 'Chat', messages: msgs })
  }

  function handleSurfaceChange(surface: ActiveSurface) {
    const wm = surfaceToWorkspaceMode[surface]
    setActiveSurface(surface)
    setWorkspaceMode(wm)
    updateSurface(surface, wm)
  }

  function handleModelChange(id: string) {
    setModelId(id)
    updateModelId(id)
  }

  function handleSwitchSession(id: string) {
    const s = sessions.find((sess) => sess.id === id)
    if (!s) return
    switchSession(id)
    setActiveSurface(s.surface)
    setWorkspaceMode(s.workspaceMode)
    setMessages(s.messages.length > 0 ? s.messages : initialMessages)
    setModelId(s.modelId)
  }

  async function handleSend(content: string, attachments: PendingAttachment[] = [], _selectedMcpTools?: string[]) {
    await handleSendRaw(content, attachments, messages)
  }

  function handleStop() {
    abortControllerRef.current?.abort()
  }

  async function handleFanout(content: string, attachments: PendingAttachment[]) {
    const fanoutModelIds = settings.fanoutModels.slice(0, settings.fanoutConcurrency)
    if (fanoutModelIds.length === 0) return

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content,
      workspace_mode: workspaceMode,
      created_at: new Date().toISOString(),
      attachments: attachments.length > 0 ? attachments : undefined,
    }

    // Create one assistant placeholder per model
    const assistantSlots: Array<{ id: string; modelId: string; label: string }> = fanoutModelIds.map((mid) => {
      const m = models.find((x) => x.id === mid)
      return { id: crypto.randomUUID(), modelId: mid, label: m?.label ?? mid }
    })

    const slotMessages: ChatMessage[] = assistantSlots.map(({ id, label }) => ({
      id,
      role: 'assistant' as const,
      content: '',
      fanout_model: label,
      created_at: new Date().toISOString(),
    }))

    const outbound: ChatMessage = {
      ...userMessage,
      content: workspaceMode !== 'Chat' ? `[${workspaceMode}] ${content}` : content,
    }

    autoTitle(content)
    const baseMessages = messages
    setMessages([...baseMessages, userMessage, ...slotMessages])
    setIsStreaming(true)
    const abort = new AbortController()
    abortControllerRef.current = abort

    const providerKeys = {
      anthropic:  settings.anthropicApiKey  || undefined,
      openai:     settings.openaiApiKey     || undefined,
      google:     settings.googleApiKey     || undefined,
      mistral:    settings.mistralApiKey    || undefined,
      neuronpedia: settings.neuronpediaApiKey || undefined,
    }

    try {
      await Promise.all(
        assistantSlots.map(({ id: assistantId, modelId: fanModelId }) =>
          sendNoeticaChat(
            {
              session_id: activeSession?.id ?? 'local-session',
              mode,
              model_id: fanModelId,
              messages: [...baseMessages, outbound],
              memory_scope: `noetica-session-local:${workspaceMode.toLowerCase()}`,
              provider_keys: providerKeys,
            },
            {
              onMeta: () => {},
              onDelta: (delta) => appendAssistantContent(assistantId, delta),
              onThinkingDelta: (delta) => appendAssistantThinking(assistantId, delta),
              onThinkingDone: (thinking) => updateAssistant(assistantId, { thinking }),
              onDone: (result) => updateAssistant(assistantId, { content: result.content }),
              onError: (error) => updateAssistant(assistantId, { content: `Error: ${error}` }),
            },
            {},
            abort.signal
          )
        )
      )
    } finally {
      abortControllerRef.current = null
      setIsStreaming(false)
      setMessages((current) => { updateMessages(current); return current })
    }
  }

  function handleFork(messageId: string) {
    const idx = messages.findIndex((m) => m.id === messageId)
    if (idx === -1) return
    const forkedMessages = messages.slice(0, idx + 1)
    const forkedTitle = `Fork — ${activeSession?.title ?? 'Chat'}`
    const sess = newSession({ surface: activeSurface, workspaceMode, messages: forkedMessages, title: forkedTitle, parentId: activeSession?.id })
    setMessages(forkedMessages)
    setActiveSurface(activeSurface)
    setWorkspaceMode(workspaceMode)
    setModelId(sess.modelId)
  }

  async function handleRecombine(selected: ChatMessage[]) {
    const synthPrompt = [
      'Below are responses from multiple models to the same prompt. Synthesize them into a single, comprehensive answer, integrating the strongest points from each:\n',
      ...selected.map((m, i) => `**Response ${i + 1} (${m.fanout_model ?? 'model'}):**\n${m.content}`),
    ].join('\n\n')
    await handleSendRaw(synthPrompt, [], messages)
  }

  async function handleEdit(messageId: string, newContent: string) {
    const idx = messages.findIndex((m) => m.id === messageId)
    if (idx === -1) return
    const base = messages.slice(0, idx)
    setMessages(base)
    await handleSendRaw(newContent, [], base)
  }

  async function handleRegenerate() {
    // Find last user message, strip the last assistant message, resend
    const lastUserIdx = [...messages].reverse().findIndex((m) => m.role === 'user')
    if (lastUserIdx === -1) return
    const userMsg = messages[messages.length - 1 - lastUserIdx]
    // Trim messages to just before the last assistant response
    const trimmed = messages.slice(0, messages.length - 1 - lastUserIdx)
    setMessages(trimmed)
    await handleSendRaw(userMsg.content, userMsg.attachments ?? [], trimmed)
  }

  function autoTitle(content: string) {
    if (!activeSession) return
    if (activeSession.title !== 'New workspace' && activeSession.title !== 'New Chat') return
    const hasUserMsg = activeSession.messages.some((m) => m.role === 'user')
    if (hasUserMsg) return
    const words = content.trim().split(/\s+/).slice(0, 6).join(' ')
    updateTitle(words || 'Chat')
  }

  async function handleSendRaw(content: string, attachments: PendingAttachment[], baseMessages: ChatMessage[]) {
    autoTitle(content)
    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content,
      workspace_mode: workspaceMode,
      created_at: new Date().toISOString(),
      attachments: attachments.length > 0 ? attachments : undefined,
    }
    const assistantId = crypto.randomUUID()
    const assistantMessage: ChatMessage = {
      id: assistantId,
      role: 'assistant',
      content: '',
      created_at: new Date().toISOString(),
    }
    const outbound: ChatMessage = {
      ...userMessage,
      content: workspaceMode !== 'Chat' ? `[${workspaceMode}] ${content}` : content,
    }
    const next = [...baseMessages, userMessage, assistantMessage]
    setMessages(next)
    setIsStreaming(true)
    const abort = new AbortController()
    abortControllerRef.current = abort
    const providerKeys = {
      anthropic:  settings.anthropicApiKey  || undefined,
      openai:     settings.openaiApiKey     || undefined,
      google:     settings.googleApiKey     || undefined,
      mistral:    settings.mistralApiKey    || undefined,
      neuronpedia: settings.neuronpediaApiKey || undefined,
    }
    const agentMachineEndpoint =
      settings.runtimeMode === 'agent-machine' && settings.agentMachineEndpoint
        ? settings.agentMachineEndpoint
        : undefined
    try {
      await sendNoeticaChat(
        {
          session_id: activeSession?.id ?? 'local-session',
          mode,
          model_id: modelId,
          messages: [...baseMessages, outbound],
          steering,
          thinking_budget: thinkingBudget,
          memory_scope: `noetica-session-local:${workspaceMode.toLowerCase()}`,
          provider_keys: providerKeys,
          agent_machine_endpoint: agentMachineEndpoint,
        },
        {
          onMeta: (governance) => updateAssistant(assistantId, { governance }),
          onDelta: (delta) => appendAssistantContent(assistantId, delta),
          onThinkingDelta: (delta) => appendAssistantThinking(assistantId, delta),
          onThinkingDone: (thinking) => updateAssistant(assistantId, { thinking }),
          onDone: (result) => {
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
            })
          },
          onError: (error) =>
            updateAssistant(assistantId, { content: `Noetica route error: ${error}` }),
        },
        {},
        abort.signal
      )
    } finally {
      abortControllerRef.current = null
      setIsStreaming(false)
      setMessages((current) => { updateMessages(current); return current })
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

  function appendAssistantThinking(id: string, delta: string) {
    setMessages((current) =>
      current.map((m) => (m.id === id ? { ...m, thinking: `${m.thinking ?? ''}${delta}` } : m))
    )
  }

  return (
    <>
      <main className="flex h-screen overflow-hidden bg-[var(--color-background-tertiary)] text-[var(--color-text-primary)]">
        {!sidebarCollapsed && (
          <Sidebar
            activeSurface={activeSurface}
            onSurfaceChange={handleSurfaceChange}
            onOpenSettings={(cat) => openSettings(cat)}
            sessions={sessions}
            activeSessionId={activeSession?.id ?? null}
            onSwitchSession={handleSwitchSession}
            onRemoveSession={removeSession}
            onNewChat={handleNewChat}
            density={settings.sidebarDensity}
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
            riskReadout={riskReadout}
            voiceState={voiceState}
            onModeChange={setMode}
            onModelChange={handleModelChange}
            onOpenSettings={(cat) => openSettings(cat)}
            onOpenPalette={() => setPaletteOpen(true)}
            onOpenInspector={() => setInspectorVisible(true)}
            onVoiceStart={startListening}
            onVoiceStop={stopListening}
          />

          <div className="flex min-h-0 flex-1 overflow-hidden">
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
                fanoutModelCount={fanoutModelCount}
                modelId={modelId}
                thinkingBudget={thinkingBudget}
                onSend={handleSend}
                onFanout={handleFanout}
                onStop={handleStop}
                onRegenerate={handleRegenerate}
                onFork={handleFork}
                onEdit={handleEdit}
                onRecombine={handleRecombine}
                onWorkspaceModeChange={setWorkspaceMode}
                onExtractArtifact={handleExtractArtifact}
                onModelChange={handleModelChange}
                onOpenPalette={() => setPaletteOpen(true)}
                mcpTools={mcpTools}
              />
              {inspectorVisible && (
                <RightPanel
                  activeSurface={activeSurface}
                  model={activeModel}
                  steering={steering}
                  thinkingBudget={thinkingBudget}
                  workspaceMode={workspaceMode}
                  riskReadout={riskReadout}
                  onSteeringChange={setSteering}
                  onThinkingBudgetChange={setThinkingBudget}
                />
              )}
            </div>
            <UtilityRail activePanel={utilityPanel} onSelect={setUtilityPanel} lastGovernance={lastGovernance} />
          </div>
        </section>

        <RightSidebar
          collapsed={rightSidebarCollapsed}
          onCollapse={() => setRightSidebarCollapsed(true)}
          onExpand={() => setRightSidebarCollapsed(false)}
          riskReadout={riskReadout}
        />
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

// ─── Collapsed icon rail ──────────────────────────────────────────────────────

type CollapsedRailProps = {
  activeSurface: ActiveSurface
  onSurfaceChange: (s: ActiveSurface) => void
  onExpand: () => void
}

function IconSm({ path, d2 }: { path: string; d2?: string }) {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d={path} stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
      {d2 && <path d={d2} stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>}
    </svg>
  )
}

const surfaceIcons: { id: ActiveSurface; label: string; icon: React.ReactNode }[] = [
  { id: 'chat',      label: 'Workspace',    icon: <IconSm path="M2 3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H5l-3 2V3Z" /> },
  { id: 'projects',  label: 'Projects',     icon: <IconSm path="M2 2h5v5H2zM9 2h5v5H9z" d2="M2 9h5v5H2zM9 11h6M12 8.5v5" /> },
  { id: 'artifacts', label: 'Artifacts',    icon: <IconSm path="M4 2h5l3 3v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z" d2="M9 2v3h3M6 8h4M6 11h3" /> },
  { id: 'evaluate',  label: 'Evaluate',     icon: <IconSm path="M2 9h3v5H2zM6.5 6h3v8h-3zM11 3h3v11h-3z" /> },
  { id: 'tune',      label: 'Tune & Train', icon: <IconSm path="M5 1v12M11 1v12" d2="M3 5h4M9 11h4" /> },
  { id: 'govern',    label: 'Govern',       icon: <IconSm path="M8 2 2 5v3c0 3 2.5 5.5 6 6.5 3.5-1 6-3.5 6-6.5V5L8 2z" d2="M5.5 8l2 2 3.5-3.5" /> },
  { id: 'holographme',  label: 'HolographMe',  icon: <IconSm path="M8 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM3 14c0-2.8 2.2-5 5-5s5 2.2 5 5" /> },
  { id: 'marketplace',  label: 'Marketplace',  icon: <IconSm path="M2 5h12l-1.5 7H3.5L2 5z" d2="M5 5V3.5a3 3 0 0 1 6 0V5" /> },
]

function CollapsedRail({ activeSurface, onSurfaceChange, onExpand }: CollapsedRailProps) {
  return (
    <aside className="hidden w-14 shrink-0 flex-col items-center border-r border-[var(--color-border-tertiary)] bg-[var(--color-background-tertiary)] py-3 lg:flex">
      <button
        onClick={onExpand}
        className="mb-3 flex h-8 w-8 items-center justify-center rounded-lg text-[var(--color-text-secondary)] transition hover:bg-[var(--color-background-primary)] hover:text-[var(--color-text-primary)]"
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
            className={`flex h-8 w-8 items-center justify-center rounded-lg transition ${
              activeSurface === id
                ? 'bg-[#dbeafe] text-[var(--color-text-primary)]'
                : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-background-primary)] hover:text-[var(--color-text-primary)]'
            }`}
          >
            {icon}
          </button>
        ))}
      </nav>
    </aside>
  )
}

// ─── Center workspace ─────────────────────────────────────────────────────────

type CenterProps = {
  activeSurface: ActiveSurface
  messages: ChatMessage[]
  isStreaming: boolean
  workspaceMode: WorkspaceMode
  fanoutModelCount: number
  modelId: string
  thinkingBudget: number | undefined
  onSend: (content: string, attachments: PendingAttachment[], mcpTools?: string[]) => Promise<void>
  onFanout: (content: string, attachments: PendingAttachment[]) => Promise<void>
  onStop: () => void
  onRegenerate: () => void
  onFork: (messageId: string) => void
  onEdit: (messageId: string, newContent: string) => void
  onRecombine: (selected: ChatMessage[]) => void
  onWorkspaceModeChange: (mode: WorkspaceMode) => void
  onExtractArtifact: (content: string, messageId: string) => void
  onModelChange: (id: string) => void
  onOpenPalette: () => void
  mcpTools: McpTool[]
}

function CenterWorkspace({ activeSurface, messages, isStreaming, workspaceMode, fanoutModelCount, modelId, thinkingBudget, onSend, onFanout, onStop, onRegenerate, onFork, onEdit, onRecombine, onWorkspaceModeChange, onExtractArtifact, onModelChange, onOpenPalette, mcpTools }: CenterProps) {
  if (activeSurface === 'notes')        return <NotesSurface />
  if (activeSurface === 'workrooms')    return <WorkroomsSurface />
  if (activeSurface === 'cowork')       return <CoworkSurface />
  if (activeSurface === 'projects')     return <ProjectsSurface />
  if (activeSurface === 'artifacts')    return <ArtifactsSurface />
  if (activeSurface === 'code')         return <CodeSurface />
  if (activeSurface === 'evaluate')     return <EvaluateSurface />
  if (activeSurface === 'operate')      return <OperateSurface />
  if (activeSurface === 'govern')       return <GovernSurface />
  if (activeSurface === 'tune')         return <TuneSurface />
  if (activeSurface === 'holographme')  return <PlaceholderSurface title="HolographMe" description="Your persistent agent-facing identity and digital work presence." badge="Coming soon" />
  if (activeSurface === 'marketplace')  return <PlaceholderSurface title="Agent Supervisor Marketplace" description="Post availability as an agent supervisor. Browse and hire supervisors. Reputation accrues from agent performance." badge="Coming soon" />

  return (
    <section className="flex min-h-0 flex-col">
      <MessageList messages={messages} isStreaming={isStreaming} onExtractArtifact={onExtractArtifact} onRegenerate={onRegenerate} onFork={onFork} onEdit={onEdit} onRecombine={onRecombine} />
      <InputArea
        onSend={onSend}
        onFanout={onFanout}
        onStop={onStop}
        disabled={isStreaming}
        fanoutModelCount={fanoutModelCount}
        workspaceMode={workspaceMode}
        onWorkspaceModeChange={onWorkspaceModeChange}
        mcpTools={mcpTools}
        modelId={modelId}
        onModelChange={onModelChange}
        thinkingBudget={thinkingBudget}
        onOpenPalette={onOpenPalette}
      />
    </section>
  )
}

function PlaceholderSurface({ title, description, badge }: { title: string; description: string; badge?: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-[var(--color-border-tertiary)] bg-[var(--color-background-secondary)] text-2xl">
        {title.includes('Holo') ? '🪪' : '🏪'}
      </div>
      <div>
        <div className="flex items-center justify-center gap-2">
          <h2 className="text-base font-semibold text-[var(--color-text-primary)]">{title}</h2>
          {badge && <span className="rounded-md bg-[var(--color-background-secondary)] px-2 py-0.5 text-[10px] font-medium text-[var(--color-text-secondary)]">{badge}</span>}
        </div>
        <p className="mt-1 max-w-sm text-sm text-[var(--color-text-secondary)]">{description}</p>
      </div>
    </div>
  )
}

// ─── Right panel ──────────────────────────────────────────────────────────────

type RightPanelProps = {
  activeSurface: ActiveSurface
  model: ModelConfig
  steering: SteeringConfig | undefined
  thinkingBudget: number | undefined
  workspaceMode: WorkspaceMode
  riskReadout?: ReturnType<typeof buildRiskAversionLiveReadout>
  onSteeringChange: (config: SteeringConfig | undefined) => void
  onThinkingBudgetChange: (budget: number | undefined) => void
}

function RightPanel({ activeSurface, model, steering, thinkingBudget, workspaceMode, riskReadout, onSteeringChange, onThinkingBudgetChange }: RightPanelProps) {
  if (activeSurface === 'notes')     return null
  if (activeSurface === 'workrooms') return null
  if (activeSurface === 'tune')      return null
  if (activeSurface === 'cowork')    return <CoworkPanel />
  if (activeSurface === 'projects')  return <CoworkPanel />
  if (activeSurface === 'artifacts') return null
  if (activeSurface === 'code')      return <CodePanel />
  if (activeSurface === 'evaluate')  return <EvaluatePanel />
  if (activeSurface === 'operate')   return null
  if (activeSurface === 'govern')      return <GovernPanel />
  if (activeSurface === 'holographme') return null
  if (activeSurface === 'marketplace') return null
  return (
    <SteeringPanel
      model={model}
      steering={steering}
      thinkingBudget={thinkingBudget}
      workspaceMode={workspaceMode}
      riskReadout={riskReadout}
      onChange={onSteeringChange}
      onThinkingBudgetChange={onThinkingBudgetChange}
    />
  )
}
