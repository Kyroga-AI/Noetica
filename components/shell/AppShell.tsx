'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Sidebar } from '@/components/shell/Sidebar'
import { Topbar } from '@/components/shell/Topbar'
import { MessageList } from '@/components/chat/MessageList'
import { InputArea, type WorkspaceMode } from '@/components/chat/InputArea'
import { SteeringPanel } from '@/components/steering/SteeringPanel'
import { NotesSurface } from '@/components/surfaces/NotesSurface'
import { CanvasSurface } from '@/components/surfaces/CanvasSurface'
import { ComputerUseSurface } from '@/components/surfaces/ComputerUseSurface'
import { WorkroomsSurface } from '@/components/surfaces/WorkroomsSurface'
import { CoworkSurface } from '@/components/surfaces/CoworkSurface'
import { CodeSurface } from '@/components/surfaces/CodeSurface'
import { EvaluateSurface } from '@/components/surfaces/EvaluateSurface'
import { GovernSurface } from '@/components/surfaces/GovernSurface'
import { ProjectsSurface } from '@/components/surfaces/ProjectsSurface'
import { ArtifactsSurface } from '@/components/surfaces/ArtifactsSurface'
import { ArtifactPane } from '@/components/artifacts/ArtifactPane'
import { OperateSurface } from '@/components/surfaces/OperateSurface'
import { TuneSurface } from '@/components/surfaces/TuneSurface'
import { CoworkPanel } from '@/components/panels/CoworkPanel'
import { CodePanel } from '@/components/panels/CodePanel'
import { EvaluatePanel } from '@/components/panels/EvaluatePanel'
import { GovernPanel } from '@/components/panels/GovernPanel'
import { SettingsModal } from '@/components/settings/SettingsModal'
import { ProviderSetupModal } from '@/components/shell/ProviderSetupModal'
import { ModelSetupModal } from '@/components/shell/ModelSetupModal'
import { CommandPalette } from '@/components/palette/CommandPalette'
import { models, visibleModels, defaultModelId } from '@/config/models'
import { initialMessages } from '@/lib/chat/mockConversation'
import { sendNoeticaChat } from '@/lib/client/noeticaTransport'
import { buildRiskAversionLiveReadout } from '@/lib/risk/riskAversionLive'
import { listenTauri, isTauri, invokeTauri } from '@/lib/tauri/bridge'
import { executeBuiltinToolDirect } from '@/lib/client/anthropicDirect'
import { useSession } from '@/lib/session/useSession'
import { useArtifacts } from '@/lib/artifacts/useArtifacts'
import { useProjects } from '@/lib/projects/useProjects'
import { ProjectsPanel } from '@/components/projects/ProjectsPanel'
import { useMcp } from '@/lib/mcp/useMcp'
import { useSettings } from '@/lib/settings/context'
import { useVoice } from '@/lib/voice/useVoice'
import { useMemory } from '@/lib/memory/useMemory'
import { buildMemoryContext } from '@/lib/memory/manager'
import { appendLedgerEntry } from '@/lib/evidence/ledger-store'
import { RightSidebar } from '@/components/shell/RightSidebar'
import { UtilityRail, type UtilityPanelId } from '@/components/rail/UtilityRail'
import { RuntimeStatus } from '@/components/status/RuntimeStatus'
import type { PendingAttachment } from '@/lib/types/attachment'
import type { McpTool } from '@/lib/types/mcp'
import type { ChatMessage, ToolCallRecord, ToolResultRecord } from '@/lib/types/message'
import type { Artifact } from '@/lib/types/artifact'
import type { SteeringConfig } from '@/lib/types/steering'
import type { NoeticaMode } from '@/lib/client/noeticaTransport'
import type { ActiveSurface } from '@/lib/types/surface'
import type { ModelConfig } from '@/lib/types/model'
import type { GovernanceTrace } from '@/lib/types/governance'
import type { ProviderTool, ToolUseBlock } from '@/lib/providers'
import { mcpManager } from '@/lib/mcp/client'

const SURFACE_ORDER: ActiveSurface[] = ['chat', 'notes', 'canvas', 'workrooms', 'cowork', 'projects', 'artifacts', 'code', 'evaluate', 'operate', 'computer']

const surfaceToWorkspaceMode: Record<ActiveSurface, WorkspaceMode> = {
  chat:         'Chat',
  notes:        'Chat',
  canvas:       'Chat',
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
  computer:     'Chat',
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
      // Only restore model if it's in the currently-visible list (guards against
      // Neuronpedia/cloud models that were saved before showAllModels was toggled off)
      const allowed = visibleModels(settings.showAllModels)
      const isUsable = allowed.some((m) => m.id === activeSession.modelId)
      setModelId(isUsable ? activeSession.modelId : defaultModelId)
    } else {
      // No saved session — create one for the current initial state
      newSession({ surface: 'chat', workspaceMode: 'Chat', messages: initialMessages })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated])

  // ── Settings (provider keys, runtime mode) ───────────────────────────────
  const { settings, update: updateSettings } = useSettings()

  // ── MCP ───────────────────────────────────────────────────────────────────
  const { tools: mcpTools } = useMcp()

  // ── Projects ──────────────────────────────────────────────────────────────
  const { activeProject } = useProjects()

  // ── Memory ────────────────────────────────────────────────────────────────
  const { memoryContext, remember, search: searchMemory, entries: memoryEntries, purgeExpired, hydrated: memoryHydrated } = useMemory()

  // ── Artifacts ─────────────────────────────────────────────────────────────
  const { createArtifact, updateArtifact, deleteArtifact } = useArtifacts()
  const [activeArtifact, setActiveArtifact] = useState<Artifact | null>(null)

  function handleExtractArtifact(content: string, messageId: string) {
    const trimmed = content.trim()
    const isHtml = trimmed.startsWith('<') && trimmed.includes('</')
    const codeMatch = trimmed.match(/^```(\w+)?\n([\s\S]+?)```/)
    let artifact: Artifact
    if (isHtml) {
      artifact = createArtifact({ type: 'html', title: 'HTML artifact', content: trimmed, messageId })
    } else if (codeMatch) {
      const lang = codeMatch[1] ?? 'other'
      artifact = createArtifact({ type: 'code', title: `Code — ${lang}`, language: lang, content: codeMatch[2], messageId })
    } else {
      artifact = createArtifact({ type: 'document', title: content.slice(0, 50).trim() || 'Document', content: trimmed, messageId })
    }
    // Auto-open the artifact panel in the chat view
    setActiveArtifact(artifact)
  }

  function handleOpenArtifact(artifact: Artifact) {
    setActiveArtifact(artifact)
    // Switch to chat surface so the panel is visible
    if (activeSurface !== 'chat') handleSurfaceChange('chat')
  }

  // ── Shell state ────────────────────────────────────────────────────────────
  const [mode, setMode] = useState<NoeticaMode>('standalone')
  const [steering, setSteering] = useState<SteeringConfig | undefined>()
  const [thinkingBudget, setThinkingBudget] = useState<number | undefined>()
  const [temperature, setTemperature] = useState<number | undefined>()
  const [maxTokens, setMaxTokens] = useState<number | undefined>()
  const [systemPrompt, setSystemPrompt] = useState<string>('')
  const [isStreaming, setIsStreaming] = useState(false)
  const abortControllerRef = useRef<AbortController | null>(null)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [rightSidebarCollapsed, setRightSidebarCollapsed] = useState(false)
  const [utilityPanel, setUtilityPanel] = useState<UtilityPanelId | null>(null)
  const [inspectorVisible, setInspectorVisible] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsCategory, setSettingsCategory] = useState('appearance')
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [providerSetupOpen, setProviderSetupOpen] = useState(false)
  const [modelSetupOpen, setModelSetupOpen] = useState(false)
  const [rawEventLog, setRawEventLog] = useState<Array<{ ts: string; kind: string; payload: unknown }>>([])
  const rawEventLogRef = useRef(rawEventLog)
  rawEventLogRef.current = rawEventLog

  // Show provider setup on first load when no keys configured AND not in local-first mode
  useEffect(() => {
    if (settings.anthropicApiKey || settings.openaiApiKey) return
    if (settings.runtimeMode === 'agent-machine' && settings.agentMachineEndpoint) return
    const dismissed = sessionStorage.getItem('noetica-provider-setup-dismissed')
    if (!dismissed) setProviderSetupOpen(true)
  }, [settings.anthropicApiKey, settings.openaiApiKey, settings.runtimeMode, settings.agentMachineEndpoint])

  // Show model setup when agent machine connects and models haven't been pulled yet
  useEffect(() => {
    if (!settings.agentMachineEndpoint) return
    const dismissed = localStorage.getItem('noetica-model-setup-dismissed')
    if (dismissed) return
    void fetch(`${settings.agentMachineEndpoint}/api/models`)
      .then((r) => r.ok ? r.json() as Promise<{ allPulled: boolean }> : null)
      .then((data) => { if (data && !data.allPulled) setModelSetupOpen(true) })
      .catch(() => { /* agent machine not running yet */ })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.agentMachineEndpoint])

  const activeModel = useMemo(
    () => models.find((m) => m.id === modelId) ?? models[0],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [modelId]
  )
  const riskReadout = useMemo(() => buildRiskAversionLiveReadout(messages), [messages])
  const lastGovernance = useMemo<GovernanceTrace | undefined>(
    () => [...messages].reverse().find((m) => m.governance !== undefined)?.governance,
    [messages]
  )
  const fanoutModelCount = Math.min(settings.fanoutModels.length, settings.fanoutConcurrency)

  function exportConversation() {
    const lines: string[] = []
    const now = new Date().toISOString().slice(0, 10)
    lines.push(`# Noetica Conversation — ${now}`)
    lines.push(`Model: ${modelId}`)
    lines.push('')
    for (const msg of messages) {
      if (msg.role === 'system') continue
      const role = msg.role === 'user' ? '**You**' : '**Noetica**'
      lines.push(`${role}`)
      if (msg.thinking) {
        lines.push(`<details><summary>Extended thinking</summary>\n\n${msg.thinking}\n\n</details>`)
      }
      lines.push(msg.content)
      if (msg.governance?.latency_ms) {
        const toks = msg.governance.input_tokens || msg.governance.output_tokens
          ? ` · ${msg.governance.input_tokens ?? '–'} in / ${msg.governance.output_tokens ?? '–'} out`
          : ''
        lines.push(`*${(msg.governance.latency_ms / 1000).toFixed(1)}s${toks}*`)
      }
      lines.push('')
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `noetica-conversation-${now}.md`
    a.click()
    URL.revokeObjectURL(url)
  }

  const { state: voiceState, startListening, stopListening, speak, stopSpeaking } = useVoice((transcript) => {
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

  // ── Agent Machine auto-connect ────────────────────────────────────────────
  // In Tauri: listen for the sidecar started event.
  // In browser: probe the default port on startup so dev mode just works.
  useEffect(() => {
    let unlisten: (() => void) | undefined
    listenTauri('noetica:am:started', (payload) => {
      const { url } = payload as { url: string }
      updateSettings({ agentMachineEndpoint: url, runtimeMode: 'agent-machine' })
    }).then((fn) => { unlisten = fn })

    // Use Tauri command to get AM URL — avoids WKWebView mixed-content blocking.
    if (isTauri()) {
      void invokeTauri<string | null>('probe_agent_machine')
        .then((url) => {
          if (url) updateSettings({ agentMachineEndpoint: url, runtimeMode: 'agent-machine' })
        })
        .catch(() => {})
    }

    return () => unlisten?.()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Apply appearance settings to document ─────────────────────────────────
  useEffect(() => {
    const sizes: Record<string, string> = { sm: 'sm', md: 'md', lg: 'lg' }
    document.documentElement.setAttribute('data-font-size', sizes[settings.fontSize] ?? 'md')
  }, [settings.fontSize])

  // Enforce memory retention policy after hydration
  useEffect(() => {
    if (memoryHydrated && settings.memoryRetentionDays > 0) {
      purgeExpired(settings.memoryRetentionDays)
    }
  }, [memoryHydrated, settings.memoryRetentionDays, purgeExpired])

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
    const allowed = visibleModels(settings.showAllModels)
    setModelId(allowed.some((m) => m.id === s.modelId) ? s.modelId : defaultModelId)
  }

  function buildEffectiveSystemPrompt(
    userSystemPrompt: string,
    memCtx: string | null,
    memScope: string
  ): string | undefined {
    const parts: string[] = []
    if (memCtx && memScope !== 'disabled') parts.push(memCtx)
    // Active project system prompt takes precedence over the manual system prompt field
    const projectPrompt = activeProject?.systemPrompt?.trim()
    if (projectPrompt) parts.push(`## Project: ${activeProject!.title}\n${projectPrompt}`)
    if (userSystemPrompt.trim()) parts.push(userSystemPrompt.trim())
    return parts.length > 0 ? parts.join('\n\n') : undefined
  }

  function buildBuiltinTools(s: typeof settings): ProviderTool[] {
    const tools: ProviderTool[] = []
    if (s.serperApiKey || s.openaiApiKey) {
      tools.push({
        name: 'web_search',
        description: 'Search the web for current information. Returns a list of relevant results with titles, URLs, and snippets.',
        input_schema: {
          type: 'object',
          properties: { query: { type: 'string', description: 'The search query' } },
          required: ['query'],
        },
      })
    }
    if (s.openaiApiKey) {
      tools.push({
        name: 'generate_image',
        description: 'Generate an image using DALL-E 3. Returns a URL to the generated image.',
        input_schema: {
          type: 'object',
          properties: { prompt: { type: 'string', description: 'A detailed description of the image to generate' } },
          required: ['prompt'],
        },
      })
    }
    // code_execute — persistent Python sessions, matplotlib auto-saves charts
    tools.push({
      name: 'code_execute',
      description: 'Execute Python or JavaScript code. Python sessions are persistent — variables and imports survive between calls. matplotlib.pyplot.show() auto-saves charts. Returns stdout and any generated files.',
      input_schema: {
        type: 'object',
        properties: {
          language:   { type: 'string', enum: ['python', 'javascript'] },
          code:       { type: 'string', description: 'Code to execute' },
          session_id: { type: 'string', description: 'Session ID for persistent Python state (optional)' },
        },
        required: ['language', 'code'],
      },
    })
    // filesystem tools — available in Tauri desktop
    tools.push({
      name: 'read_file',
      description: 'Read a local file as text (≤ 2 MB). Use absolute or ~/relative paths.',
      input_schema: {
        type: 'object',
        properties: { path: { type: 'string', description: 'File path' } },
        required: ['path'],
      },
    })
    tools.push({
      name: 'write_file',
      description: 'Write text content to a local file. Creates parent directories as needed.',
      input_schema: {
        type: 'object',
        properties: {
          path:    { type: 'string', description: 'File path' },
          content: { type: 'string', description: 'Text content to write' },
        },
        required: ['path', 'content'],
      },
    })
    tools.push({
      name: 'list_directory',
      description: 'List files and subdirectories at a path.',
      input_schema: {
        type: 'object',
        properties: { path: { type: 'string', description: 'Directory path' } },
        required: ['path'],
      },
    })
    return tools
  }

  async function handleSend(content: string, attachments: PendingAttachment[] = [], selectedMcpToolNames?: string[]) {
    // Build ProviderTool list from selected MCP tools
    const selectedTools: ProviderTool[] = selectedMcpToolNames?.length
      ? mcpTools
          .filter((t) => selectedMcpToolNames.includes(`${t.serverId}:${t.name}`))
          .map((t) => ({
            name: t.name,
            description: t.description ?? '',
            input_schema: t.inputSchema,
            serverId: t.serverId,
          }))
      : []

    // Always include built-in tools
    const builtinTools = buildBuiltinTools(settings)
    const tools = [...builtinTools, ...selectedTools]

    await handleSendRaw(content, attachments, messages, tools)
  }

  function handleStop() {
    abortControllerRef.current?.abort()
    stopSpeaking()
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
    const allowed = visibleModels(settings.showAllModels)
    setModelId(allowed.some((m) => m.id === sess.modelId) ? sess.modelId : defaultModelId)
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

  async function handleSendRaw(content: string, attachments: PendingAttachment[], baseMessages: ChatMessage[], tools?: ProviderTool[]) {
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
      anthropic:   settings.anthropicApiKey   || undefined,
      openai:      settings.openaiApiKey      || undefined,
      google:      settings.googleApiKey      || undefined,
      mistral:     settings.mistralApiKey     || undefined,
      neuronpedia: settings.neuronpediaApiKey || undefined,
      serper:      settings.serperApiKey      || undefined,
    }
    const agentMachineEndpoint =
      settings.runtimeMode === 'agent-machine' && settings.agentMachineEndpoint
        ? settings.agentMachineEndpoint
        : undefined

    // Per-turn semantic memory retrieval — selects relevant memories for this specific query
    let turnMemoryContext = memoryContext
    if (settings.memoryScope !== 'disabled' && memoryEntries.length > 0) {
      const relevant = await searchMemory(content, 8, settings.openaiApiKey || undefined)
      turnMemoryContext = buildMemoryContext({ version: 1, entries: [] }, relevant)
    }

    // Agentic tool-use loop: keep calling until stop_reason is not 'tool_use'
    let conversationMessages: ChatMessage[] = [...baseMessages, outbound]
    let pendingToolCalls: ToolUseBlock[] | undefined
    const MAX_TOOL_TURNS = 10

    try {
      for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
        pendingToolCalls = undefined

        await sendNoeticaChat(
          {
            session_id: activeSession?.id ?? 'local-session',
            mode,
            // In agent-machine mode, only pass model_id for known Ollama/Anthropic/OpenAI
            // models — let prophet-mesh routing decide for everything else.
            model_id: agentMachineEndpoint
              ? (['claude', 'gpt', 'o1', 'o3', 'o4', 'qwen', 'llama3', 'deepseek', 'mistral'].some(p => modelId.startsWith(p)) ? modelId : undefined)
              : modelId,
            messages: conversationMessages,
            steering,
            thinking_budget: thinkingBudget,
            temperature,
            max_tokens: maxTokens,
            memory_scope: `noetica-session-local:${workspaceMode.toLowerCase()}`,
            provider_keys: providerKeys,
            agent_machine_endpoint: agentMachineEndpoint,
            tools: tools?.length ? tools : undefined,
            system_prompt: buildEffectiveSystemPrompt(systemPrompt, turnMemoryContext, settings.memoryScope),
            policy_profile: settings.defaultPolicyProfile,
            api_endpoint_override: settings.apiEndpointOverride || undefined,
          },
          {
            onMeta: (governance) => {
              updateAssistant(assistantId, { governance })
              if (settings.showRawEvents) {
                setRawEventLog((prev) => [{ ts: new Date().toISOString(), kind: 'meta', payload: governance }, ...prev].slice(0, 80))
              }
            },
            onDelta: (delta) => {
              appendAssistantContent(assistantId, delta)
              if (settings.showRawEvents) {
                setRawEventLog((prev) => [{ ts: new Date().toISOString(), kind: 'delta', payload: delta.slice(0, 60) }, ...prev].slice(0, 80))
              }
            },
            onThinkingDelta: (delta) => {
              appendAssistantThinking(assistantId, delta)
              if (settings.showRawEvents) {
                setRawEventLog((prev) => [{ ts: new Date().toISOString(), kind: 'thinking_delta', payload: delta.slice(0, 60) }, ...prev].slice(0, 80))
              }
            },
            onThinkingDone: (thinking) => updateAssistant(assistantId, { thinking }),
            onToolCalls: (calls) => {
              pendingToolCalls = calls
              if (settings.showRawEvents) {
                setRawEventLog((prev) => [{ ts: new Date().toISOString(), kind: 'tool_calls', payload: calls }, ...prev].slice(0, 80))
              }
            },
            onDone: (result) => {
              if (settings.showRawEvents) {
                setRawEventLog((prev) => [{ ts: new Date().toISOString(), kind: 'done', payload: { run_id: result.run_id, model: result.model_routed, latency_ms: result.latency_ms } }, ...prev].slice(0, 80))
              }
              void appendLedgerEntry({
                id: result.run_id ?? crypto.randomUUID(),
                timestamp: result.timestamp ?? new Date().toISOString(),
                session_id: activeSession?.id ?? 'local',
                kind: 'chat_request',
                model_id: result.model_routed ?? modelId,
                provider: result.provider ?? 'unknown',
                latency_ms: result.latency_ms ?? 0,
                input_tokens: result.input_tokens,
                output_tokens: result.output_tokens,
                request_hash: result.request_hash,
                evidence_hash: result.evidence_hash,
                content_preview: result.content.slice(0, 120),
                memory_scope: `noetica-session-local:${workspaceMode.toLowerCase()}`,
                policy_admitted: result.policy_admitted,
                policy_profile: settings.defaultPolicyProfile,
              })
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
                  ...(result.input_tokens !== undefined ? { input_tokens: result.input_tokens } : {}),
                  ...(result.output_tokens !== undefined ? { output_tokens: result.output_tokens } : {}),
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

        // If no tool calls or aborted, done.
        // When the AM is handling the loop server-side, tool_calls events are informational only
        // (for UI display). The AM continues the loop itself and emits done when finished.
        const activeCalls = pendingToolCalls as ToolUseBlock[] | undefined
        if (!activeCalls?.length || abort.signal.aborted || agentMachineEndpoint) break

        // Execute all tool calls
        const toolResults = await executeToolCalls(activeCalls, providerKeys)

        // Store tool calls and results on the visible assistant message for display
        updateAssistant(assistantId, {
          tool_calls: activeCalls.map((c): ToolCallRecord => ({ id: c.id, name: c.name, input: c.input })),
          tool_results: toolResults.map((r): ToolResultRecord => ({ id: r.id, name: r.name, result: r.result })),
        })

        // Build conversation messages for the follow-up request
        // Assistant turn: content + tool_use markers (Anthropic-style)
        const assistantToolMsg: ChatMessage = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: activeCalls.map((c) => `[tool_use:${c.name}]`).join(' '),
          created_at: new Date().toISOString(),
          tool_calls: activeCalls.map((c): ToolCallRecord => ({ id: c.id, name: c.name, input: c.input })),
        }
        // User turn: tool results
        const toolResultMsg: ChatMessage = {
          id: crypto.randomUUID(),
          role: 'user',
          content: toolResults.map((r) => `[tool_result:${r.name}]\n${r.result}`).join('\n\n'),
          created_at: new Date().toISOString(),
          tool_results: toolResults.map((r): ToolResultRecord => ({ id: r.id, name: r.name, result: r.result })),
        }
        conversationMessages = [...conversationMessages, assistantToolMsg, toolResultMsg]
      }
    } finally {
      abortControllerRef.current = null
      setIsStreaming(false)
      setMessages((current) => {
        const last = [...current].reverse().find((m: ChatMessage) => m.role === 'assistant')

        // TTS: read final assistant message aloud when voice was active
        if (voiceState !== 'idle' && last?.content) {
          speak(last.content.replace(/\[.*?\]/g, '').trim())
        }

        // Auto-memory: extract [REMEMBER: ...] markers from the response
        if (last?.content && settings.memoryScope !== 'disabled') {
          const markerRe = /\[REMEMBER:\s*(.+?)\]/gi
          let m: RegExpExecArray | null
          while ((m = markerRe.exec(last.content)) !== null) {
            if (m[1]) remember(m[1].trim(), { sessionId: activeSession?.id, source: 'auto' })
          }
        }

        updateMessages(current)
        return current
      })
    }
  }

  async function executeToolCalls(
    calls: ToolUseBlock[],
    providerKeys: { serper?: string; openai?: string; [k: string]: string | undefined }
  ): Promise<Array<{ id: string; name: string; result: string }>> {
    return Promise.all(calls.map(async (call) => {
      try {
        // Filesystem tools — Tauri only (no browser equivalent)
        if (call.name === 'read_file' || call.name === 'write_file' || call.name === 'list_directory') {
          if (isTauri()) {
            const result = await executeBuiltinToolDirect(call.name, call.input, {})
            return { id: call.id, name: call.name, result }
          }
          // Browser fallback via Agent Machine proxy
          const res = await fetch('/api/agent-tool', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ tool: call.name, input: call.input }),
          })
          if (!res.ok) return { id: call.id, name: call.name, result: `Error: ${res.statusText}` }
          const data = await res.json() as { result?: string; error?: string }
          return { id: call.id, name: call.name, result: data.result ?? data.error ?? '(empty)' }
        }

        // Built-in tools — call APIs directly in Tauri (no /api/* routes in static export)
        if (call.name === 'web_search' || call.name === 'generate_image' || call.name === 'code_execute') {
          if (isTauri()) {
            const result = await executeBuiltinToolDirect(call.name, call.input, {
              serper: providerKeys.serper,
              openai: providerKeys.openai,
            })
            return { id: call.id, name: call.name, result }
          }

          // Browser / dev server path via API routes
          if (call.name === 'web_search') {
            const query = (call.input.query as string | undefined) ?? ''
            const res = await fetch('/api/search', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ query, provider_keys: { serper: providerKeys.serper } }),
            })
            const data = await res.json() as { results?: Array<{ title: string; url: string; snippet: string }>; error?: string }
            if (data.error) return { id: call.id, name: call.name, result: `Error: ${data.error}` }
            const results = (data.results ?? []).map((r) => `- [${r.title}](${r.url}): ${r.snippet}`).join('\n')
            return { id: call.id, name: call.name, result: results || 'No results found.' }
          }

          if (call.name === 'generate_image') {
            const prompt = (call.input.prompt as string | undefined) ?? ''
            const res = await fetch('/api/generate-image', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ prompt, provider_keys: { openai: providerKeys.openai } }),
            })
            const data = await res.json() as { url?: string; revised_prompt?: string; error?: string }
            if (data.error) return { id: call.id, name: call.name, result: `Error: ${data.error}` }
            const caption = data.revised_prompt ? `\n*${data.revised_prompt}*` : ''
            return { id: call.id, name: call.name, result: `![Generated image](${data.url})${caption}` }
          }

          // code_execute
          if (call.name === 'code_execute') {
            const language = (call.input.language as 'python' | 'javascript' | undefined) ?? 'javascript'
            const code = (call.input.code as string | undefined) ?? ''
            const session_id = (call.input.session_id as string | undefined) ?? activeSession?.id ?? 'default'
            const res = await fetch('/api/execute', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ language, code, session_id }),
            })
            const data = await res.json() as { output?: string; exit_code?: number; runtime_ms?: number; files?: Array<{ name: string; base64: string; mimeType: string }>; error?: string }
            if (data.error) return { id: call.id, name: call.name, result: `Error: ${data.error}` }
            const header = `[${language} · ${data.runtime_ms ?? 0}ms · exit ${data.exit_code ?? 0}]`
            let result = `${header}\n${data.output ?? '(no output)'}`
            for (const f of data.files ?? []) {
              if (f.mimeType.startsWith('image/')) {
                result += `\n![${f.name}](data:${f.mimeType};base64,${f.base64})`
              } else {
                result += `\n[File: ${f.name} (${f.mimeType})]`
              }
            }
            return { id: call.id, name: call.name, result }
          }
        }

        // MCP tools
        if (call.serverId) {
          const mcpResult = await mcpManager.callTool({
            serverId: call.serverId,
            toolName: call.name,
            args: call.input,
          })
          const resultText = mcpResult.content
            .map((c: { type?: string; text?: string }) => (c.type === 'text' ? c.text ?? '' : JSON.stringify(c)))
            .join('\n')
          return { id: call.id, name: call.name, result: resultText || '(empty result)' }
        }

        return { id: call.id, name: call.name, result: `Unknown tool: ${call.name}` }
      } catch (err) {
        return { id: call.id, name: call.name, result: `Error: ${err instanceof Error ? err.message : String(err)}` }
      }
    }))
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
            openaiApiKey={settings.openaiApiKey || undefined}
            hasMessages={messages.filter((m) => m.role !== 'system').length > 0}
            onModeChange={setMode}
            onModelChange={handleModelChange}
            onOpenSettings={(cat) => openSettings(cat)}
            onOpenPalette={() => setPaletteOpen(true)}
            onOpenInspector={() => setInspectorVisible(true)}
            onExportConversation={exportConversation}
            onVoiceStart={startListening}
            onVoiceStop={stopListening}
            onRealtimeTranscript={(text) => void handleSendRaw(text, [], messages)}
            onRealtimeSpeechStart={stopSpeaking}
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
                systemPrompt={systemPrompt}
                onSystemPromptChange={setSystemPrompt}
                activeArtifact={activeArtifact}
                onCloseArtifact={() => setActiveArtifact(null)}
                onArtifactUpdate={updateArtifact}
                onArtifactDelete={(id) => { deleteArtifact(id); setActiveArtifact(null) }}
              />
              {inspectorVisible && (
                <RightPanel
                  activeSurface={activeSurface}
                  model={activeModel}
                  steering={steering}
                  thinkingBudget={thinkingBudget}
                  temperature={temperature}
                  maxTokens={maxTokens}
                  workspaceMode={workspaceMode}
                  riskReadout={riskReadout}
                  onSteeringChange={setSteering}
                  onThinkingBudgetChange={setThinkingBudget}
                  onTemperatureChange={setTemperature}
                  onMaxTokensChange={setMaxTokens}
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

      {providerSetupOpen && (
        <ProviderSetupModal
          onClose={() => {
            sessionStorage.setItem('noetica-provider-setup-dismissed', '1')
            setProviderSetupOpen(false)
          }}
        />
      )}
      {modelSetupOpen && settings.agentMachineEndpoint && (
        <ModelSetupModal
          agentMachineEndpoint={settings.agentMachineEndpoint}
          onDismiss={() => {
            localStorage.setItem('noetica-model-setup-dismissed', '1')
            setModelSetupOpen(false)
          }}
        />
      )}
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
      {settings.showRawEvents && rawEventLog.length > 0 && (
        <div
          style={{
            position: 'fixed', bottom: 8, right: 8, zIndex: 9999,
            width: 420, maxHeight: 280,
            background: 'rgba(0,0,0,0.88)', color: '#a3e635',
            fontFamily: 'monospace', fontSize: 11, borderRadius: 6,
            overflow: 'hidden', display: 'flex', flexDirection: 'column',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 8px', borderBottom: '1px solid #333' }}>
            <span style={{ color: '#fbbf24', fontWeight: 700 }}>SSE events</span>
            <button onClick={() => setRawEventLog([])} style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', fontSize: 11 }}>clear</button>
          </div>
          <div style={{ overflowY: 'auto', flex: 1, padding: '4px 8px' }}>
            {rawEventLog.map((e, i) => (
              <div key={i} style={{ borderBottom: '1px solid #222', paddingBottom: 2, marginBottom: 2 }}>
                <span style={{ color: '#94a3b8' }}>{e.ts.slice(11, 23)}</span>
                {' '}
                <span style={{ color: '#38bdf8', fontWeight: 700 }}>{e.kind}</span>
                {' '}
                <span style={{ color: '#d1fae5', wordBreak: 'break-all' }}>
                  {typeof e.payload === 'string' ? e.payload : JSON.stringify(e.payload)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
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
  { id: 'canvas',    label: 'Canvas',       icon: <IconSm path="M3 2h8l2 2v9a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z" d2="M5 6h6M5 9h4" /> },
  { id: 'projects',  label: 'Projects',     icon: <IconSm path="M2 2h5v5H2zM9 2h5v5H9z" d2="M2 9h5v5H2zM9 11h6M12 8.5v5" /> },
  { id: 'artifacts', label: 'Artifacts',    icon: <IconSm path="M4 2h5l3 3v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z" d2="M9 2v3h3M6 8h4M6 11h3" /> },
  { id: 'evaluate',  label: 'Evaluate',     icon: <IconSm path="M2 9h3v5H2zM6.5 6h3v8h-3zM11 3h3v11h-3z" /> },
  { id: 'tune',      label: 'Tune & Train', icon: <IconSm path="M5 1v12M11 1v12" d2="M3 5h4M9 11h4" /> },
  { id: 'govern',    label: 'Govern',       icon: <IconSm path="M8 2 2 5v3c0 3 2.5 5.5 6 6.5 3.5-1 6-3.5 6-6.5V5L8 2z" d2="M5.5 8l2 2 3.5-3.5" /> },
  { id: 'computer',     label: 'Computer Use', icon: <IconSm path="M1.5 3h13a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" d2="M5 15h6M8 12v3" /> },
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
  systemPrompt?: string
  onSystemPromptChange?: (prompt: string) => void
  activeArtifact?: Artifact | null
  onCloseArtifact?: () => void
  onArtifactUpdate?: (id: string, patch: Partial<Artifact>) => void
  onArtifactDelete?: (id: string) => void
}

function CenterWorkspace({ activeSurface, messages, isStreaming, workspaceMode, fanoutModelCount, modelId, thinkingBudget, onSend, onFanout, onStop, onRegenerate, onFork, onEdit, onRecombine, onWorkspaceModeChange, onExtractArtifact, onModelChange, onOpenPalette, mcpTools, systemPrompt, onSystemPromptChange, activeArtifact, onCloseArtifact, onArtifactUpdate, onArtifactDelete }: CenterProps) {
  if (activeSurface === 'notes')        return <NotesSurface />
  if (activeSurface === 'canvas')       return <CanvasSurface />
  if (activeSurface === 'workrooms')    return <WorkroomsSurface thinkingBudget={thinkingBudget} />
  if (activeSurface === 'cowork')       return <CoworkSurface thinkingBudget={thinkingBudget} />
  if (activeSurface === 'projects')     return <ProjectsPanel />
  if (activeSurface === 'artifacts')    return <ArtifactsSurface />
  if (activeSurface === 'code')         return <CodeSurface />
  if (activeSurface === 'evaluate')     return <EvaluateSurface thinkingBudget={thinkingBudget} />
  if (activeSurface === 'operate')      return <OperateSurface />
  if (activeSurface === 'govern') {
    const traces = messages
      .filter((m) => m.role === 'assistant' && m.governance)
      .map((m) => ({ messageId: m.id, content: m.content.slice(0, 80), governance: m.governance! }))
    return <GovernSurface recentTraces={traces} />
  }
  if (activeSurface === 'tune')         return <TuneSurface thinkingBudget={thinkingBudget} />
  if (activeSurface === 'computer')     return <ComputerUseSurface />
  if (activeSurface === 'holographme')  return <PlaceholderSurface title="HolographMe" description="Your persistent agent-facing identity and digital work presence." badge="Coming soon" />
  if (activeSurface === 'marketplace')  return <PlaceholderSurface title="Agent Supervisor Marketplace" description="Post availability as an agent supervisor. Browse and hire supervisors. Reputation accrues from agent performance." badge="Coming soon" />

  return (
    <div className={`grid min-h-0 flex-1 overflow-hidden transition-[grid-template-columns] duration-300 ${activeArtifact ? 'grid-cols-[minmax(320px,1fr)_480px]' : 'grid-cols-1'}`}>
      <section className="flex min-h-0 flex-col overflow-hidden">
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
          systemPrompt={systemPrompt}
          onSystemPromptChange={onSystemPromptChange}
        />
      </section>

      {activeArtifact && onCloseArtifact && (
        <ArtifactPane
          artifact={activeArtifact}
          onClose={onCloseArtifact}
          onUpdate={onArtifactUpdate ?? (() => {})}
          onDelete={onArtifactDelete ?? (() => {})}
        />
      )}
    </div>
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
  temperature: number | undefined
  maxTokens: number | undefined
  workspaceMode: WorkspaceMode
  riskReadout?: ReturnType<typeof buildRiskAversionLiveReadout>
  onSteeringChange: (config: SteeringConfig | undefined) => void
  onThinkingBudgetChange: (budget: number | undefined) => void
  onTemperatureChange: (v: number | undefined) => void
  onMaxTokensChange: (v: number | undefined) => void
}

function RightPanel({ activeSurface, model, steering, thinkingBudget, temperature, maxTokens, workspaceMode, riskReadout, onSteeringChange, onThinkingBudgetChange, onTemperatureChange, onMaxTokensChange }: RightPanelProps) {
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
      temperature={temperature}
      maxTokens={maxTokens}
      workspaceMode={workspaceMode}
      riskReadout={riskReadout}
      onChange={onSteeringChange}
      onThinkingBudgetChange={onThinkingBudgetChange}
      onTemperatureChange={onTemperatureChange}
      onMaxTokensChange={onMaxTokensChange}
    />
  )
}
