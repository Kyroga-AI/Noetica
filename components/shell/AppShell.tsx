'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Sidebar } from '@/components/shell/Sidebar'
import { useResizable } from '@/components/shell/useResizable'
import { CommandCenterRail } from '@/components/shell/CommandCenterRail'
import { NAV_SURFACES, surfacesFor, type CommandCenterId } from '@/components/shell/commandCenters'
import { ResizeHandle } from '@/components/shell/ResizeHandle'
import { Topbar } from '@/components/shell/Topbar'
import { MessageList } from '@/components/chat/MessageList'
import { GoalBanner } from '@/components/chat/GoalBanner'
import { InputArea, type WorkspaceMode } from '@/components/chat/InputArea'
import { SteeringPanel } from '@/components/steering/SteeringPanel'
import { NotesSurface } from '@/components/surfaces/NotesSurface'
import { CanvasSurface } from '@/components/surfaces/CanvasSurface'
import { ComputerUseSurface } from '@/components/surfaces/ComputerUseSurface'
import { WorkroomsSurface } from '@/components/surfaces/WorkroomsSurface'
import { CoworkSurface } from '@/components/surfaces/CoworkSurface'
import { CodeSurface } from '@/components/surfaces/CodeSurface'
import { DeploySurface } from '@/components/surfaces/DeploySurface'
import { TerminalSurface } from '@/components/surfaces/TerminalSurface'
import { SearchSurface } from '@/components/surfaces/SearchSurface'
import { ServicesSurface } from '@/components/surfaces/ServicesSurface'
import { LabsSurface } from '@/components/surfaces/LabsSurface'
import { PipelinesSurface } from '@/components/surfaces/PipelinesSurface'
import { KnowledgeGraphSurface } from '@/components/surfaces/KnowledgeGraphSurface'
import { WorkspaceSurface } from '@/components/surfaces/WorkspaceSurface'
import { EvaluateSurface } from '@/components/surfaces/EvaluateSurface'
import { StudioSurface } from '@/components/surfaces/StudioSurface'
import { RagInspectSurface } from '@/components/surfaces/RagInspectSurface'
import { LabSurface } from '@/components/surfaces/LabSurface'
import { CloudBrokerSurface } from '@/components/surfaces/CloudBrokerSurface'
import { AlignmentSurface } from '@/components/surfaces/AlignmentSurface'
import { AgentBuilderSurface } from '@/components/surfaces/AgentBuilderSurface'
import { LibrarySurface } from '@/components/surfaces/LibrarySurface'
import { GeoSurface } from '@/components/surfaces/GeoSurface'
import { IntelligenceSurface } from '@/components/surfaces/IntelligenceSurface'
import { PortfolioSurface } from '@/components/surfaces/PortfolioSurface'
import { CalendarSurface } from '@/components/surfaces/CalendarSurface'
import { JitsiSurface } from '@/components/surfaces/JitsiSurface'
import { OfficeViewer } from '@/components/surfaces/OfficeViewer'
import { GovernSurface } from '@/components/surfaces/GovernSurface'
import { ProjectsSurface } from '@/components/surfaces/ProjectsSurface'
import { ArtifactsSurface } from '@/components/surfaces/ArtifactsSurface'
import { ArtifactPane } from '@/components/artifacts/ArtifactPane'
import { OperateSurface } from '@/components/surfaces/OperateSurface'
import { TuneSurface } from '@/components/surfaces/TuneSurface'
import { HolographMeSurface } from '@/components/surfaces/HolographMeSurface'
import { MarketplaceSurface } from '@/components/surfaces/MarketplaceSurface'
import { SurfaceErrorBoundary } from '@/components/shell/SurfaceErrorBoundary'
import { TabbedWorkspace } from '@/components/shell/TabbedWorkspace'
import { CoworkPanel } from '@/components/panels/CoworkPanel'
import { CodePanel } from '@/components/panels/CodePanel'
import { EvaluatePanel } from '@/components/panels/EvaluatePanel'
import { GovernPanel } from '@/components/panels/GovernPanel'
import { SettingsModal } from '@/components/settings/SettingsModal'
import { ProviderSetupModal } from '@/components/shell/ProviderSetupModal'
import { ModelSetupOverlay } from '@/components/setup/ModelSetupOverlay'
import { CitizenOnboardingWizard } from '@/components/shell/CitizenOnboardingWizard'
import { OrgOnboardingWizard } from '@/components/shell/OrgOnboardingWizard'
import { CommandPalette } from '@/components/palette/CommandPalette'
import { models, visibleModels, providersWithKeys, defaultModelId } from '@/config/models'
import { initialMessages } from '@/lib/chat/mockConversation'
import { matchDialogue, type DialogueForm, type DialogueCommand } from '@/lib/chat/dialogue'
import { sendNoeticaChat } from '@/lib/client/noeticaTransport'
import { buildRiskAversionLiveReadout } from '@/lib/risk/riskAversionLive'
import { listenTauri, isTauri, invokeTauri } from '@/lib/tauri/bridge'
import { executeBuiltinToolDirect } from '@/lib/client/anthropicDirect'
import { readRepo } from '@/lib/tools/repoRead'
import { useSession } from '@/lib/session/useSession'
import { useArtifacts } from '@/lib/artifacts/useArtifacts'
import { useProjects } from '@/lib/projects/useProjects'
import { projectCollectionId, chatCollectionId, type RetrievalScope } from '@/lib/projects/types'
import { ProjectsPanel } from '@/components/projects/ProjectsPanel'
import { useMcp } from '@/lib/mcp/useMcp'
import { useSettings } from '@/lib/settings/context'
import { useVoice } from '@/lib/voice/useVoice'
import { useMemory } from '@/lib/memory/useMemory'
import { buildMemoryContext } from '@/lib/memory/manager'
import { appendLedgerEntry } from '@/lib/evidence/ledger-store'
import { RightSidebar } from '@/components/shell/RightSidebar'
import { UtilityRail, type UtilityPanelId } from '@/components/rail/UtilityRail'
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
import { amUrl } from '@/lib/tauri/bridge'

// ⌘1–⌘9 surface shortcuts. Order MUST match the Command Palette / Help modal
// shortcut list so the advertised keys actually land on the right surface.
const SURFACE_ORDER: ActiveSurface[] = ['chat', 'notes', 'workrooms', 'cowork', 'projects', 'artifacts', 'code', 'evaluate', 'operate']

const surfaceToWorkspaceMode: Record<ActiveSurface, WorkspaceMode> = {
  chat:         'Chat',
  notes:        'Chat',
  canvas:       'Chat',
  workrooms:    'Collaborate',
  cowork:       'Collaborate',
  projects:     'Collaborate',
  artifacts:    'Chat',
  code:         'Code',
  deploy:       'Code',
  terminal:     'Code',
  services:     'Code',
  pipelines:    'Code',
  labs:         'Chat',
  search:       'Chat',
  workspace:    'Code',
  evaluate:     'Benchmark',
  studio:       'Chat',
  rag:          'Chat',
  lab:          'Chat',
  jitsi:        'Chat',
  docs:         'Chat',
  operate:      'Chat',
  govern:       'Chat',
  tune:         'Chat',
  holographme:  'Chat',
  geo:          'Chat',
  marketplace:  'Chat',
  computer:     'Chat',
  broker:       'Chat',
  alignment:    'Chat',
  agents:       'Chat',
  calendar:     'Chat',
  library:      'Chat',
  kg:           'Chat',
  intelligence: 'Chat',
  portfolio:    'Chat',
  platform:     'Chat',
}

export function AppShell() {
  // ── Settings (provider keys, runtime mode) ───────────────────────────────
  const { settings, update: updateSettings } = useSettings()

  // Security lane armed = 'security' profile + accepted self-attestation. While
  // armed, chats are ephemeral and obliterated after securityEphemeralMinutes.
  const securityArmed = settings.defaultPolicyProfile === 'security' && settings.securityAttestation?.accepted === true
  const ephemeralTtlMinutes = securityArmed ? (settings.securityEphemeralMinutes ?? 15) : null

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
    setSessionVisibility,
    obliterateNow,
  } = useSession(defaultModelId, { ephemeralTtlMinutes })

  // Disarming the lane (revoke attestation / leave the security profile) obliterates
  // any ephemeral sessions immediately — don't wait for the reaper window.
  const wasArmedRef = useRef(securityArmed)
  useEffect(() => {
    if (wasArmedRef.current && !securityArmed) obliterateNow()
    wasArmedRef.current = securityArmed
  }, [securityArmed, obliterateNow])

  // Desktop overlay titlebar: mark the root so the left rails/sidebar inset their
  // tops to clear the floating macOS traffic lights (see .titlebar-inset in CSS).
  useEffect(() => {
    if (isTauri()) document.documentElement.setAttribute('data-titlebar-overlay', '1')
  }, [])

  // ── Derive surface / messages from active session (with local overrides) ──
  const [activeSurface, setActiveSurface] = useState<ActiveSurface>('chat')
  const [activeTopicScope, setActiveTopicScope] = useState<string | null>(null)   // blekko-style /topic search scope
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>('Chat')
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages)
  // Local dialogue form: when set, the next user turn fills the slot → dispatches to model.
  const [pendingForm, setPendingForm] = useState<DialogueForm | null>(null)
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
      const allowed = visibleModels(settings.showAllModels, providersWithKeys(settings))
      const isUsable = allowed.some((m) => m.id === activeSession.modelId)
      setModelId(isUsable ? activeSession.modelId : defaultModelId)
    } else {
      // No saved session — create one for the current initial state
      newSession({ surface: 'chat', workspaceMode: 'Chat', messages: initialMessages })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated])

  // ── MCP ───────────────────────────────────────────────────────────────────
  const { tools: mcpTools } = useMcp()

  // ── Projects ──────────────────────────────────────────────────────────────
  const { activeProject, projects, activeProjectId, setActiveProject } = useProjects()

  // ── Memory ────────────────────────────────────────────────────────────────
  const { memoryContext, remember, search: searchMemory, entries: memoryEntries, purgeExpired, hydrated: memoryHydrated } = useMemory()

  // ── Artifacts ─────────────────────────────────────────────────────────────
  const { createArtifact, updateArtifact, deleteArtifact } = useArtifacts()
  const [activeArtifact, setActiveArtifact] = useState<Artifact | null>(null)

  // Context compaction — keeps the last KEEP_TURNS turns verbatim + a compressed
  // summary of older turns to stay under the 16K local context window.
  // Compression uses key nouns/terms extracted from older messages.
  const KEEP_TURNS = 16  // ~8 exchanges — covers typical working context
  const COMPACTION_CHAR_LIMIT = 40_000  // ~10K tokens at 4 chars/token

  function compactContext(messages: ChatMessage[]): ChatMessage[] {
    // Estimate total size
    const totalChars = messages.reduce((acc, m) => acc + m.content.length, 0)
    if (messages.length <= KEEP_TURNS || totalChars < COMPACTION_CHAR_LIMIT) return messages

    const keep = messages.slice(-KEEP_TURNS)
    const older = messages.slice(0, -KEEP_TURNS)

    // Extract key terms from older messages for the summary
    const STOP = new Set(['with','that','this','from','have','will','been','were','they',
      'them','what','when','where','which','your','about','like','just','know'])
    const termFreq = new Map<string, number>()
    for (const m of older) {
      const tokens = m.content.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
      for (const t of tokens) {
        if (t.length >= 4 && !STOP.has(t)) termFreq.set(t, (termFreq.get(t) ?? 0) + 1)
      }
    }
    const topTerms = [...termFreq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 30)
      .map(([t]) => t)
      .join(', ')

    const turnCount = Math.floor(older.length / 2)
    const summaryMsg: ChatMessage = {
      id: `compacted-${Date.now()}`,
      role: 'system',
      content: `[Context compacted — ${turnCount} earlier exchange${turnCount !== 1 ? 's' : ''} summarized. Key topics: ${topTerms}. Full history available in memory graph.]`,
      created_at: new Date().toISOString(),
    }

    return [summaryMsg, ...keep]
  }

  // Auto-extract artifacts from assistant response content.
  // Creates artifacts for HTML and substantial code blocks (>80 chars).
  // Skips shell output, logs, and trivially short snippets.
  function extractArtifactsFromResponse(
    content: string,
    messageId: string,
  ): Array<Parameters<typeof createArtifact>[0]> {
    const results: Array<Parameters<typeof createArtifact>[0]> = []
    const SKIP_LANGS = new Set(['bash', 'sh', 'shell', 'console', 'output', 'log', 'text', 'plain', ''])

    // Full HTML document
    const trimmed = content.trim()
    if (/<!DOCTYPE html>/i.test(trimmed) || (trimmed.startsWith('<html') && trimmed.includes('</html>'))) {
      return [{ type: 'html', title: 'HTML page', content: trimmed, messageId }]
    }

    // Fenced code blocks ≥80 chars
    const codeRe = /```(\w*)\n([\s\S]+?)```/g
    let m: RegExpExecArray | null
    while ((m = codeRe.exec(content)) !== null) {
      const lang = (m[1] ?? '').toLowerCase()
      const code = m[2] ?? ''
      if (code.trim().length < 80) continue
      if (SKIP_LANGS.has(lang)) continue
      if (lang === 'html') {
        results.push({ type: 'html', title: 'HTML snippet', content: code.trim(), messageId })
      } else {
        results.push({ type: 'code', title: `${lang || 'code'} snippet`, language: lang || 'text', content: code.trim(), messageId })
      }
      if (results.length >= 3) break  // cap at 3 per response
    }
    return results
  }

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
  // Domain rail (far-left icon strip) — visible by default, toggleable (low-frequency nav). Focus mode
  // is a master override: when on it hides rail + sidebar + right rail for a clean full-width chat.
  const [railCollapsed, setRailCollapsed] = useState(false)
  const [focusMode, setFocusMode] = useState(false)
  const [utilityPanel, setUtilityPanel] = useState<UtilityPanelId | null>('graph')
  const [inspectorVisible, setInspectorVisible] = useState(false)
  // The answer the right-rail "Answer" inspector is showing. Clicking Inspect on a reply sets this and
  // flips the rail to the answer panel — telemetry lives here, not sprayed across the message stream.
  const [inspectMessage, setInspectMessage] = useState<ChatMessage | null>(null)
  const handleInspect = (m: ChatMessage) => { setInspectMessage(m); setUtilityPanel('answer') }
  // Tier-1 command center (which domain the left panel is showing). Derived from
  // the active surface via the nav registry, so the rail highlight always follows
  // wherever navigation lands.
  const [activeCenter, setActiveCenter] = useState<CommandCenterId>('workspace')
  useEffect(() => {
    const s = NAV_SURFACES.find((s) => s.id === activeSurface)
    if (s) setActiveCenter(s.center)
  }, [activeSurface])
  // Picking a command center navigates to its first real (non-gap, shipped) surface;
  // if a center is all-planned, just switch the panel.
  const handleCenterChange = useCallback((center: CommandCenterId) => {
    const first = surfacesFor(center).find(
      (s) => !s.gap && s.tier !== 'tab' && s.tier !== 'hidden' && s.maturity !== 'planned',
    )
    if (first) handleSurfaceChange(first.id as ActiveSurface)
    else setActiveCenter(center)
  }, [])
  // Draggable widths for the two shell panels (persisted; double-click seam to reset).
  const leftPanel = useResizable({ storageKey: 'noetica.sidebar.width', initial: 224, min: 180, max: 420, side: 'left' })
  const rightPanel = useResizable({ storageKey: 'noetica.inspector.width', initial: 320, min: 260, max: 640, side: 'right' })
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsCategory, setSettingsCategory] = useState('appearance')
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [providerSetupOpen, setProviderSetupOpen] = useState(false)
  const [showSetup, setShowSetup] = useState(false)
  const [showCitizenOnboarding, setShowCitizenOnboarding] = useState(false)
  const [showOrgOnboarding, setShowOrgOnboarding] = useState(false)
  const [rawEventLog, setRawEventLog] = useState<Array<{ ts: string; kind: string; payload: unknown }>>([])
  const rawEventLogRef = useRef(rawEventLog)
  rawEventLogRef.current = rawEventLog

  // Citizen first-run onboarding: show once, after the infrastructure setup modals
  // (provider keys / model download) have had a chance to appear. Triggered by absence
  // of the `noetica:citizen:onboarded` key — independent of whether the user has a name set.
  useEffect(() => {
    if (localStorage.getItem('noetica:citizen:onboarded') === '1') return
    // Small delay so infrastructure modals (provider/model) appear first if needed
    const t = setTimeout(() => setShowCitizenOnboarding(true), 800)
    return () => clearTimeout(t)
  }, [])

  // Org onboarding: fires once after citizen is onboarded, with a 1.5s delay.
  // Citizen is always first; this follows if they haven't set up an org yet.
  useEffect(() => {
    if (localStorage.getItem('noetica:citizen:onboarded') !== '1') return
    if (localStorage.getItem('noetica:org:onboarded') === '1') return
    const t = setTimeout(() => setShowOrgOnboarding(true), 1500)
    return () => clearTimeout(t)
  }, [])

  // Show provider setup on first load when no keys configured AND not in local-first mode
  useEffect(() => {
    if (settings.anthropicApiKey || settings.openaiApiKey) return
    if (settings.runtimeMode === 'agent-machine' && settings.agentMachineEndpoint) return
    const dismissed = sessionStorage.getItem('noetica-provider-setup-dismissed')
    if (!dismissed) setProviderSetupOpen(true)
  }, [settings.anthropicApiKey, settings.openaiApiKey, settings.runtimeMode, settings.agentMachineEndpoint])

  // Show first-run model setup only when a REQUIRED model is missing (the optional
  // models never auto-pull, so gating on "all pulled" would re-show it every launch).
  useEffect(() => {
    if (!settings.agentMachineEndpoint) return
    if (localStorage.getItem('noetica:setup:skipped') === '1') return
    void fetch(`${settings.agentMachineEndpoint}/api/models`)
      .then((r) => r.ok ? r.json() as Promise<{ models?: Array<{ required?: boolean; pulled?: boolean }> }> : null)
      .then((data) => {
        const requiredMissing = (data?.models ?? []).some((m) => m.required && !m.pulled)
        if (requiredMissing) setShowSetup(true)
      })
      .catch(() => { /* agent machine not running yet */ })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.agentMachineEndpoint])

  const activeModel = useMemo(
    () => models.find((m) => m.id === modelId) ?? models[0],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [modelId]
  )
  const riskReadout = useMemo(() => buildRiskAversionLiveReadout(messages), [messages])
  // The Answer inspector defaults to the latest answer — you shouldn't have to click Inspect to see it.
  // An explicit Inspect click (setInspectMessage) still overrides to pin an older reply.
  const latestAnswer = useMemo(() => [...messages].reverse().find((m) => m.role === 'assistant' && !!m.content) ?? null, [messages])
  // Real "in scope" files for the Context panel: paths touched by this session's
  // filesystem tool calls (read_file / write_file / list_directory), most recent first.
  const inScopeFiles = useMemo(() => {
    const seen = new Set<string>()
    for (const m of messages) {
      for (const tc of m.tool_calls ?? []) {
        if (tc.name === 'read_file' || tc.name === 'write_file' || tc.name === 'list_directory') {
          const p = (tc.input as { path?: string } | undefined)?.path
          if (typeof p === 'string' && p.trim()) seen.add(p.trim())
        }
      }
    }
    return Array.from(seen).reverse().slice(0, 12)
  }, [messages])
  // Real tool-activity feed for the Context panel: every tool the agent ran this
  // session, most recent first, with a short target (path / query / etc.).
  const toolActivity = useMemo(() => {
    const acts: Array<{ id: string; name: string; target: string }> = []
    for (const m of messages) {
      for (const tc of m.tool_calls ?? []) {
        const inp = (tc.input ?? {}) as Record<string, unknown>
        const raw = inp['path'] ?? inp['query'] ?? inp['url'] ?? inp['prompt'] ?? (inp['code'] ? 'code' : '')
        acts.push({ id: tc.id, name: tc.name, target: typeof raw === 'string' ? raw : '' })
      }
    }
    return acts.reverse().slice(0, 20)
  }, [messages])
  // Real file changes for the Context panel: what the agent actually wrote this
  // session (write_file calls), with content, most recent first.
  const fileChanges = useMemo(() => {
    const out: Array<{ id: string; path: string; content: string }> = []
    for (const m of messages) {
      for (const tc of m.tool_calls ?? []) {
        if (tc.name !== 'write_file') continue
        const inp = (tc.input ?? {}) as Record<string, unknown>
        const path = typeof inp['path'] === 'string' ? (inp['path'] as string) : ''
        const content = typeof inp['content'] === 'string' ? (inp['content'] as string) : ''
        if (path) out.push({ id: tc.id, path, content })
      }
    }
    return out.reverse().slice(0, 12)
  }, [messages])
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

  const voiceReplyRef = useRef(false)
  // Dictation vs auto-send: when the mic was started as "dictate" (composer mic), the transcript is
  // routed into the composer to edit; otherwise (live conversation / wake word) it auto-sends.
  const dictateModeRef = useRef(false)
  const c2paCredRef = useRef<import('@/lib/types/governance').GovernanceTrace['credential']>(undefined)
  // Stable callback reference — must be memoized to avoid recreating `startListening` on every
  // render, which would retrigger the wake-word useEffect and cause a rapid restart loop.
  const handleVoiceTranscript = useCallback((transcript: string) => {
    // Dictate mode → drop the text into the composer (edit before sending); one-shot, so reset the flag.
    if (dictateModeRef.current) {
      dictateModeRef.current = false
      window.dispatchEvent(new CustomEvent('noetica:dictate', { detail: transcript }))
      return
    }
    voiceReplyRef.current = true
    setActiveSurface('chat')
    void handleSendRaw(transcript, [], messages)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages])
  const { state: voiceState, isLive, error: voiceError, speakingId, startListening, stopListening, startLive, stopLive, speak, stopSpeaking } = useVoice(handleVoiceTranscript)
  // Composer mic: dictate into the box (not auto-send). Live conversation stays a separate top-bar control.
  const startDictation = useCallback(() => {
    dictateModeRef.current = true
    setActiveSurface('chat')
    void startListening()
  }, [startListening])
  // Dictating = actively capturing for the composer (not live, not passive wake-listening).
  const isDictating = voiceState === 'listening' && !isLive

  // Surface voice errors (backend offline, mic denied, STT unavailable) as a transient
  // notice — a voice feature must never fail as a silent no-op.
  const [voiceNotice, setVoiceNotice] = useState<string | null>(null)
  useEffect(() => {
    if (!voiceError) return
    setVoiceNotice(voiceError)
    const t = setTimeout(() => setVoiceNotice(null), 6000)
    return () => clearTimeout(t)
  }, [voiceError])

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
        case 'toggle_rail':      setRailCollapsed((c) => !c); break
        case 'toggle_focus':     setFocusMode((f) => !f); break
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
      if (e.key === '|')                   { e.preventDefault(); setRailCollapsed((c) => !c) }   // ⌘⇧\ — domain rail
      if (e.key === '.')                   { e.preventDefault(); setFocusMode((f) => !f) }        // ⌘. — focus mode
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

  // Rail panels (Mail/Calendar) ask to open a specific settings category via a window event — avoids
  // threading an onOpenSettings prop through the whole rail.
  useEffect(() => {
    const h = (e: Event) => openSettings((e as CustomEvent<string>).detail || 'appearance')
    window.addEventListener('noetica:open-settings', h)
    return () => window.removeEventListener('noetica:open-settings', h)
  }, [])

  // Rail panels + cards navigate to a surface via a window event — same pattern, avoids threading a
  // nav prop everywhere. Lets dead "coming soon" buttons point at surfaces that actually exist.
  useEffect(() => {
    const h = (e: Event) => { const s = (e as CustomEvent<string>).detail; if (s) setActiveSurface(s as ActiveSurface) }
    window.addEventListener('noetica:navigate', h)
    return () => window.removeEventListener('noetica:navigate', h)
  }, [])

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

  // Execute a local dialogue command (natural-language navigation — chat as a command
  // palette). new/clear are handled before message append so they don't leave a stray turn.
  function executeDialogueCommand(cmd: DialogueCommand) {
    switch (cmd.kind) {
      case 'navigate': handleSurfaceChange(cmd.surface as ActiveSurface); break
      case 'setModel': handleModelChange(cmd.model); break
      case 'openSettings': openSettings(cmd.category ?? 'appearance'); break
      case 'setName': updateSettings({ userName: cmd.name }); break
      case 'newWorkspace':
      case 'clearChat': handleNewChat(); break
      case 'repeatLast': break // handled in the send flow (needs to re-dispatch)
      case 'setTopicScope': setActiveTopicScope(cmd.topic); break
    }
  }

  // Fire a built-in tool at the agent-machine DIRECTLY (no model) — tools, never
  // generation. Shows the user's message, a loader, then the result. Used by tool-forms
  // (research → web_search) and immediate tools (show my files → list_directory).
  async function runToolDirect(userContent: string, toolName: string, input: Record<string, string>, header: string, followups?: string[]) {
    const now = new Date().toISOString()
    const userMsg: ChatMessage = { id: crypto.randomUUID(), role: 'user', content: userContent, workspace_mode: workspaceMode, created_at: now }
    const assistantId = crypto.randomUUID()
    autoTitle(userContent)
    setMessages((cur) => [...cur, userMsg, { id: assistantId, role: 'assistant', content: '', created_at: now }])
    setIsStreaming(true)
    try {
      const base = (settings.agentMachineEndpoint || 'http://127.0.0.1:8080').replace(/\/$/, '')
      const resp = await fetch(`${base}/api/tool`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: toolName, input, provider_keys: { serper: settings.serperApiKey || undefined, openai: settings.openaiApiKey || undefined } }),
      })
      const data = await resp.json().catch(() => ({} as { result?: string; error?: string }))
      const text = String(data.result ?? data.error ?? 'No results found.')
      updateAssistant(assistantId, { content: (header ? header + '\n\n' : '') + text, quick_replies: followups })
    } catch (e) {
      updateAssistant(assistantId, { content: `That couldn't run: ${e instanceof Error ? e.message : String(e)}. The runtime may still be warming up — try again in a moment.` })
    } finally {
      setIsStreaming(false)
      setMessages((cur) => { updateMessages(cur); return cur })
    }
  }

  // Tool-form completion (research → web_search): substitute the slot value, then run.
  async function runToolForm(form: DialogueForm, value: string) {
    if (!form.tool) return
    const input: Record<string, string> = {}
    for (const [k, v] of Object.entries(form.tool.input)) input[k] = v.replace('{value}', value)
    const header = form.tool.name === 'web_search' ? `Here's what I found on **${value}**:` : ''
    await runToolDirect(value, form.tool.name, input, header, form.followups)
  }

  function handleSwitchSession(id: string) {
    const s = sessions.find((sess) => sess.id === id)
    if (!s) return
    switchSession(id)
    setActiveSurface(s.surface)
    setWorkspaceMode(s.workspaceMode)
    setMessages(s.messages.length > 0 ? s.messages : initialMessages)
    const allowed = visibleModels(settings.showAllModels, providersWithKeys(settings))
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
    // read_repo — check out a GitHub/Gitea repo (no local clone). Call with just
    // owner/repo to get the file tree, then again with `paths` to read files.
    // Private repos need a GitHub PAT (Settings → Connections).
    tools.push({
      name: 'read_repo',
      description: 'Read a GitHub or Gitea repository. Call with owner+repo (no paths) to get the file tree, then call again with a "paths" array to read specific files. Use this to inspect a repo and report on its contents.',
      input_schema: {
        type: 'object',
        properties: {
          owner:    { type: 'string', description: 'Repo owner/org, e.g. "SocioProphet"' },
          repo:     { type: 'string', description: 'Repo name, e.g. "Noetica"' },
          branch:   { type: 'string', description: 'Branch (default "main")' },
          provider: { type: 'string', enum: ['github', 'gitea'], description: 'Forge (default "github")' },
          paths:    { type: 'array', items: { type: 'string' }, description: 'Optional file paths to read; omit to list the tree' },
        },
        required: ['owner', 'repo'],
      },
    })
    return tools
  }

  async function handleSend(content: string, attachments: PendingAttachment[] = [], selectedMcpToolNames?: string[], scope?: { retrievalScope: RetrievalScope; web: boolean }) {
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

    // Slot-filling form: if we asked for a slot last turn ("Research what?"), this turn is
    // normally the answer — but first allow repair (cancel) and digression (an aside that
    // gets answered while the form stays open and re-prompts).
    if (pendingForm && attachments.length === 0) {
      const dlgCtx = { userName: settings.userName, modelLabel: modelId === 'auto' ? 'your local models (Auto)' : modelId, inForm: true }
      const aside = matchDialogue(content, dlgCtx)
      const stamp = () => new Date().toISOString()
      const appendPair = (reply: string, quickReplies?: string[]) => {
        const now = stamp()
        const u: ChatMessage = { id: crypto.randomUUID(), role: 'user', content, workspace_mode: workspaceMode, created_at: now }
        const a: ChatMessage = { id: crypto.randomUUID(), role: 'assistant', content: reply, quick_replies: quickReplies, created_at: now }
        setMessages((cur) => { const next = [...cur, u, a]; updateMessages(next); return next })
      }
      if (aside?.cancelForm) { setPendingForm(null); appendPair(aside.reply); return }
      if (aside && !aside.form) { appendPair(`${aside.reply}\n\nBack to it — what ${pendingForm.slot}?`, aside.quickReplies); return } // keep form
      const form = pendingForm
      setPendingForm(null)
      // Tool form (e.g. research → web_search): fire the tool directly, fast. Otherwise
      // it's a model-dispatch form — fill the template and send to the generative model.
      if (form.tool) { await runToolForm(form, content.trim()); return }
      const filled = (form.template ?? '{value}').replace('{value}', content.trim())
      await handleSendRaw(filled, [], messages, tools)
      return
    }

    // Grounded research mode: "research <q>" routes to /api/research/solve — a VERIFIED answer
    // (grounding-checked against the brain, with a repair loop) carrying its sources + a trust
    // score, not a free-form generation you have to second-guess.
    const researchMatch = content.match(/^\s*(?:\/research|research[:\s])\s*(.+)/is)
    if (researchMatch && attachments.length === 0) {
      const q = researchMatch[1]!.trim()
      const now = new Date().toISOString()
      const u: ChatMessage = { id: crypto.randomUUID(), role: 'user', content, workspace_mode: workspaceMode, created_at: now }
      const a: ChatMessage = { id: crypto.randomUUID(), role: 'assistant', content: '🔎 Researching the brain…', created_at: now }
      autoTitle(content)
      setMessages((cur) => { const next = [...cur, u, a]; updateMessages(next); return next })
      try {
        const r = await fetch(amUrl('/api/research/solve'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question: q }) })
        const j = (await r.json()) as { answer?: string; grounded?: boolean; score?: number; sources?: { n: number; filename: string }[] }
        const pct = Math.round((j.score ?? 0) * 100)
        const badge = j.grounded ? `✅ Grounded (${pct}%)` : `⚠️ Partially grounded (${pct}%) — treat with care`
        const srcs = (j.sources ?? []).map((s) => `[${s.n}] ${s.filename}`).join('  ·  ')
        const body = `${j.answer ?? '(no answer)'}\n\n---\n_${badge}${srcs ? `  ·  sources: ${srcs}` : ''}_`
        setMessages((cur) => { const next = cur.map((m) => (m.id === a.id ? { ...m, content: body } : m)); updateMessages(next); return next })
      } catch {
        setMessages((cur) => { const next = cur.map((m) => (m.id === a.id ? { ...m, content: 'Research failed — backend offline.' } : m)); updateMessages(next); return next })
      }
      return
    }

    // Local-first dialogue layer: answer small-talk / app-help / utilities / form-starts
    // instantly and deterministically — no model call, so it works even while the runtime
    // is warming up. Only turns that genuinely need generation fall through to the model.
    const dlg = matchDialogue(content, {
      userName: settings.userName,
      modelLabel: modelId === 'auto' ? 'your local models (Auto)' : modelId,
    })
    if (dlg && attachments.length === 0 && !selectedMcpToolNames?.length) {
      // Immediate tool (e.g. show my files → list_directory): run the tool directly, no model.
      if (dlg.runTool) {
        await runToolDirect(content, dlg.runTool.name, dlg.runTool.input, dlg.reply, dlg.quickReplies)
        return
      }
      // Build clarifier — deterministic multiple-choice card that scaffolds + runs a project.
      if (dlg.build) {
        const now = new Date().toISOString()
        const u: ChatMessage = { id: crypto.randomUUID(), role: 'user', content, workspace_mode: workspaceMode, created_at: now }
        const a: ChatMessage = { id: crypto.randomUUID(), role: 'assistant', content: '', build: dlg.build, created_at: now }
        autoTitle(content)
        setMessages((cur) => { const next = [...cur, u, a]; updateMessages(next); return next })
        return
      }
      // Commands that clear/replace the chat: execute without leaving a stray turn behind.
      if (dlg.command?.kind === 'newWorkspace' || dlg.command?.kind === 'clearChat') {
        handleNewChat()
        return
      }
      // Blekko-style /topic scope: set the scope, then re-dispatch the bare query (scoped) to the model.
      if (dlg.command?.kind === 'setTopicScope') {
        setActiveTopicScope(dlg.command.topic)
        if (dlg.command.query) { await handleSendRaw(dlg.command.topic ? `[/${dlg.command.topic}] ${dlg.command.query}` : dlg.command.query, [], messages, tools); return }
        // bare scope (or clear): show the acknowledgement turn and stop
      }
      // "again"/"repeat" — re-dispatch the previous user request to the model.
      if (dlg.command?.kind === 'repeatLast') {
        const lastUser = [...messages].reverse().find((m) => m.role === 'user')
        if (lastUser?.content) { await handleSendRaw(lastUser.content, [], messages, tools); return }
        const now = new Date().toISOString()
        const u: ChatMessage = { id: crypto.randomUUID(), role: 'user', content, workspace_mode: workspaceMode, created_at: now }
        const a: ChatMessage = { id: crypto.randomUUID(), role: 'assistant', content: 'Nothing to repeat yet — ask me something first.', created_at: now }
        setMessages((cur) => { const next = [...cur, u, a]; updateMessages(next); return next })
        return
      }
      const now = new Date().toISOString()
      const userMsg: ChatMessage = { id: crypto.randomUUID(), role: 'user', content, workspace_mode: workspaceMode, created_at: now }
      const asstMsg: ChatMessage = { id: crypto.randomUUID(), role: 'assistant', content: dlg.reply, quick_replies: dlg.quickReplies, created_at: now }
      autoTitle(content)
      setMessages((cur) => { const next = [...cur, userMsg, asstMsg]; updateMessages(next); return next })
      if (dlg.form) setPendingForm(dlg.form)
      if (dlg.command) executeDialogueCommand(dlg.command)
      return
    }

    await handleSendRaw(content, attachments, messages, tools, undefined, scope)
  }

  // Plan-mode approval gate: user approves the plan → execute in auto mode; reject → discard await.
  function handlePlanApprove(messageId: string) {
    setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, awaitingApproval: false } : m)))
    void handleSendRaw('Approved. Execute the plan exactly as outlined, step by step.', [], messages, undefined, 'auto')
  }

  function handlePlanReject(messageId: string) {
    setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, awaitingApproval: false } : m)))
  }

  // Resume an interrupted (stopped) response. The partial assistant content is
  // already in the visible transcript, so we send the same continue instruction
  // the server's checkpoint resume uses — the model picks up where it stopped.
  function handleResume() {
    void handleSend('Continue your previous response from exactly where it stopped — do not repeat what you already wrote.')
  }

  function handleStop() {
    abortControllerRef.current?.abort()
    stopSpeaking()
    // Mark the in-flight assistant message(s) — those after the last user turn —
    // as stopped so the UI shows a clear "Stopped" badge instead of a frozen stream.
    setMessages((current) => {
      const lastUserIdx = current.map((m) => m.role).lastIndexOf('user')
      return current.map((m, i) =>
        i > lastUserIdx && m.role === 'assistant' ? { ...m, stopped: true } : m,
      )
    })
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
      openrouter:  settings.openrouterApiKey  || undefined,
      huggingface: settings.huggingfaceApiKey || undefined,
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
    const allowed = visibleModels(settings.showAllModels, providersWithKeys(settings))
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

  async function handleSendRaw(content: string, attachments: PendingAttachment[], baseMessages: ChatMessage[], tools?: ProviderTool[], agentModeOverride?: 'auto' | 'plan' | 'ask', scope?: { retrievalScope: RetrievalScope; web: boolean }) {
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
      openrouter:  settings.openrouterApiKey  || undefined,
      huggingface: settings.huggingfaceApiKey || undefined,
      serper:      settings.serperApiKey      || undefined,
      githubPat:   settings.githubPat         || undefined,
      giteaBase:   settings.giteaEndpoint     || undefined,
      giteaToken:  settings.giteaToken        || undefined,
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
    // Compact context before sending — preserve last 16 turns + summary of earlier turns
    // to stay well under the 16K local context window.
    let conversationMessages: ChatMessage[] = compactContext([...baseMessages, outbound])
    let pendingToolCalls: ToolUseBlock[] | undefined
    const MAX_TOOL_TURNS = 10

    try {
      for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
        pendingToolCalls = undefined
        let turnContent = ''

        await sendNoeticaChat(
          {
            session_id: activeSession?.id ?? 'local-session',
            mode,
            // In agent-machine mode, only pass model_id for known Ollama/Anthropic/OpenAI
            // models — let prophet-mesh routing decide for everything else.
            model_id: modelId === 'auto' ? undefined : modelId,
            messages: conversationMessages,
            steering,
            thinking_budget: thinkingBudget,
            temperature,
            max_tokens: maxTokens,
            reply_length: settings.replyLength,
            agent_mode: agentModeOverride ?? settings.agentMode,
            memory_scope: `noetica-session-local:${workspaceMode.toLowerCase()}`,
            provider_keys: providerKeys,
            agent_machine_endpoint: agentMachineEndpoint,
            tools: tools?.length ? tools : undefined,
            system_prompt: buildEffectiveSystemPrompt(systemPrompt, turnMemoryContext, settings.memoryScope),
            policy_profile: settings.defaultPolicyProfile,
            security_attested: settings.defaultPolicyProfile === 'security' && settings.securityAttestation?.accepted === true,
            api_endpoint_override: settings.apiEndpointOverride || undefined,
            // Projects: confine retrieval to the active project's knowledge base (+ this chat's own docs),
            // and honor the composer's scope selector + web toggle. Unset when nothing is active → global.
            collection_id: activeProject ? projectCollectionId(activeProject.id) : undefined,
            retrieval_scope: scope?.retrievalScope,
            web: scope?.web,
            // Prophet Cloud Mesh: when opted-in, route inference to the sovereign cloud mesh.
            prophet_mesh: settings.prophetMeshEnabled && settings.prophetMeshEndpoint
              ? { enabled: true, endpoint: settings.prophetMeshEndpoint, model: settings.prophetMeshModel || undefined, api_key: settings.prophetMeshApiKey || undefined }
              : undefined,
          },
          {
            onMeta: (governance) => {
              c2paCredRef.current = undefined
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
            onRetrieval: (trace) => {
              mergeRetrieval(assistantId, trace)
              if (settings.showRawEvents) {
                setRawEventLog((prev) => [{ ts: new Date().toISOString(), kind: 'retrieval', payload: trace }, ...prev].slice(0, 80))
              }
            },
            onValueJudgment: (vj) => {
              updateAssistant(assistantId, { value_judgment: vj })
              if (settings.showRawEvents) {
                setRawEventLog((prev) => [{ ts: new Date().toISOString(), kind: 'value_judgment', payload: vj }, ...prev].slice(0, 80))
              }
            },
            onDiscipline: (d) => {
              updateAssistant(assistantId, { discipline: d })
              if (settings.showRawEvents) {
                setRawEventLog((prev) => [{ ts: new Date().toISOString(), kind: 'discipline', payload: d }, ...prev].slice(0, 80))
              }
            },
            onDeliberation: (d) => {
              updateAssistant(assistantId, { deliberation: d })
              if (settings.showRawEvents) {
                setRawEventLog((prev) => [{ ts: new Date().toISOString(), kind: 'deliberation', payload: d }, ...prev].slice(0, 80))
              }
            },
            onC2PACredential: (credential) => { if (credential) c2paCredRef.current = credential },
            // Live todo checklist (the AM streams plan + step events; render them as a checklist).
            onPlan: (plan) => updateAssistant(assistantId, { plan }),
            onStep: (step) => mergePlanStep(assistantId, step),
            onDone: (result) => {
              turnContent = result.content ?? ''
              // Voice loop: if this turn was spoken, speak the reply (and live mode re-listens).
              if (voiceReplyRef.current) { voiceReplyRef.current = false; if (result.content) void speak(result.content) }
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
                cost_usd: result.cost_usd,
                tokens_egressed: result.tokens_egressed,
                request_hash: result.request_hash,
                evidence_hash: result.evidence_hash,
                // Armed sessions are content-redacted in the durable audit: the
                // Govern metadata (model, time, policy) stays for accountability,
                // but no chat content is persisted — it's obliterated, not logged.
                content_preview: securityArmed ? '[obliterated — ephemeral security session]' : result.content.slice(0, 120),
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
                  ...(result.method !== undefined ? { method: result.method } : {}),
                  ...(result.grounded !== undefined ? { grounded: result.grounded } : {}),
                  ...(result.decidable !== undefined ? { decidable: result.decidable } : {}),
                  ...(result.replay_class !== undefined ? { replay_class: result.replay_class } : {}),
                  ...(c2paCredRef.current ? { credential: c2paCredRef.current } : {}),
                },
                steering_result: result.steering_applied,
                // The moat made visible — verification badge + inline citations from the done event.
                ...(result.verification ? { verification: result.verification } : {}),
                ...(result.citations ? { citations: result.citations } : {}),
                // Plan-mode gate: mark the turn as awaiting user approval before execution.
                ...((agentModeOverride ?? settings.agentMode) === 'plan' ? { awaitingApproval: true } : {}),
              })
            },
            onError: (error) => {
              // Self-aware: a connection/load failure right after launch means the local model
              // is still priming — caution the user gracefully instead of dumping a raw error.
              const warming = /load failed|fetch failed|econnrefused|not reachable|connection|503|timeout|loading|warm/i.test(String(error))
              updateAssistant(assistantId, {
                content: warming
                  ? '⏳ The local model is still warming up — this happens for a few seconds right after launch. Give it a moment and resend, or ask me something I can answer instantly (small talk, your files, a quick calc).'
                  : `Noetica route error: ${error}`,
              })
            },
          },
          {},
          abort.signal
        )

        // If no tool calls or aborted, done.
        // When the AM is handling the loop server-side, tool_calls events are informational only
        // (for UI display). The AM continues the loop itself and emits done when finished.
        const activeCalls = pendingToolCalls as ToolUseBlock[] | undefined
        if (!activeCalls?.length || abort.signal.aborted || agentMachineEndpoint) break

        // Auto-mode spurious-loop guard: weak local models frequently emit a tool
        // call ALONGSIDE a complete text answer, which would otherwise kick an
        // unwanted second iteration on nearly every prompt. If the model already
        // produced a substantial answer this turn, treat it as terminal in 'auto'
        // mode. 'ask'/'plan' modes gate tool use explicitly, so they are exempt.
        const effectiveMode = agentModeOverride ?? settings.agentMode
        const AUTO_TERMINAL_CONTENT_CHARS = 200
        if (effectiveMode === 'auto' && turnContent.trim().length >= AUTO_TERMINAL_CONTENT_CHARS) break

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

        // Auto-memory: extract [REMEMBER: ...] markers from the response.
        // Suppressed while the security lane is armed — armed sessions leave no
        // durable memory trace (opsec): the chat is ephemeral, so is its memory.
        if (last?.content && settings.memoryScope !== 'disabled' && !securityArmed) {
          const markerRe = /\[REMEMBER:\s*(.+?)\]/gi
          let m: RegExpExecArray | null
          while ((m = markerRe.exec(last.content)) !== null) {
            if (m[1]) remember(m[1].trim(), { sessionId: activeSession?.id, source: 'auto' })
          }
        }

        // Auto-artifact: extract code blocks and HTML from completed responses
        if (last?.content) {
          const extracted = extractArtifactsFromResponse(last.content, last.id)
          if (extracted.length > 0) {
            const created = extracted.map((a) => createArtifact(a))
            // Auto-open panel for HTML or large standalone code blocks
            const toOpen = created.find((a) =>
              a.type === 'html' || (a.type === 'code' && (a.content?.length ?? 0) > 400)
            )
            if (toOpen && extracted.length === 1) setActiveArtifact(toOpen)
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
        // read_repo — client-side GitHub/Gitea reader (works in browser and Tauri).
        if (call.name === 'read_repo') {
          const result = await readRepo(
            {
              owner: String(call.input.owner ?? ''),
              repo: String(call.input.repo ?? ''),
              branch: call.input.branch as string | undefined,
              provider: call.input.provider as 'github' | 'gitea' | undefined,
              paths: Array.isArray(call.input.paths) ? (call.input.paths as string[]) : undefined,
            },
            { githubPat: providerKeys.githubPat, giteaBase: providerKeys.giteaBase, giteaToken: providerKeys.giteaToken }
          )
          return { id: call.id, name: call.name, result }
        }

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
          const amBase = isTauri() ? 'http://127.0.0.1:8080' : ''
          const sessionId = activeSession?.id ?? 'local'

          // A2A zero-trust: emit ToolGrantCheck governance atom before dispatch
          const { emitToolGrantCheck } = await import('@/lib/a2a/grantCheck')
          emitToolGrantCheck(call.serverId, call.name, sessionId, amBase)

          const mcpResult = await mcpManager.callTool({
            serverId: call.serverId,
            toolName: call.name,
            args: call.input,
          })
          const resultText = mcpResult.content
            .map((c: { type?: string; text?: string }) => (c.type === 'text' ? c.text ?? '' : JSON.stringify(c)))
            .join('\n')

          // Ingest tool result into HellGraph as first-class knowledge atoms
          if (resultText && resultText.length > 10) {
            fetch(`${amBase}/api/graph/ingest`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                type: 'tool_result',
                payload: {
                  interaction_id: call.id,
                  session_id: sessionId,
                  content: `${call.name}: ${resultText.slice(0, 2000)}`,
                  timestamp: new Date().toISOString(),
                },
              }),
            }).catch(() => {})
          }

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

  // Merge retrieval events instead of overwriting: the graph/belief "substrate"
  // trace and the semantic-document sources arrive as separate events — keep both
  // so the answer shows graph grounding AND the cited uploaded documents.
  function mergeRetrieval(id: string, trace: import('@/lib/types/message').RetrievalTrace) {
    const isDocs = trace.patterns?.includes('semantic-documents')
    const isProvenance = (trace.memory_sources?.length ?? 0) > 0 || (trace.episode_sources?.length ?? 0) > 0
    setMessages((current) =>
      current.map((m) => {
        if (m.id !== id) return m
        const prev = m.retrieval_trace
        const merged = isProvenance
          ? { ...(prev ?? trace), memory_sources: trace.memory_sources, episode_sources: trace.episode_sources }
          : isDocs
            ? { ...(prev ?? trace), document_sources: trace.sources }
            : { ...trace, document_sources: prev?.document_sources, memory_sources: prev?.memory_sources, episode_sources: prev?.episode_sources }
        // Normalize: a provenance-only event has no patterns/timings/sources, so guarantee those arrays exist
        // (the type declares them required, and downstream rendering reads .length/.map on them).
        const combined = { ...merged, patterns: merged.patterns ?? [], timings: merged.timings ?? [], sources: merged.sources ?? [] }
        return { ...m, retrieval_trace: combined }
      })
    )
  }

  function appendAssistantContent(id: string, delta: string) {
    setMessages((current) =>
      current.map((m) => (m.id === id ? { ...m, content: `${m.content}${delta}` } : m))
    )
  }

  // Live todo checklist: merge a streamed step status update into the message's plan by id.
  function mergePlanStep(id: string, step: import('@/lib/types/message').PlanStepUpdate) {
    setMessages((current) =>
      current.map((m) => {
        if (m.id !== id || !m.plan) return m
        const steps = m.plan.steps.map((s) => (s.id === step.id ? { ...s, status: step.status, detail: step.detail ?? s.detail } : s))
        return { ...m, plan: { ...m.plan, steps } }
      })
    )
  }

  function appendAssistantThinking(id: string, delta: string) {
    setMessages((current) =>
      current.map((m) => (m.id === id ? { ...m, thinking: `${m.thinking ?? ''}${delta}` } : m))
    )
  }

  return (
    <>
      {voiceNotice && (
        <div
          role="status"
          onClick={() => setVoiceNotice(null)}
          className="fixed right-4 top-12 z-[100] max-w-sm cursor-pointer rounded-lg border border-[#fda4af] bg-[#fff1f2] px-3 py-2 text-xs text-[#9f1239] shadow-lg"
        >
          🎙️ {voiceNotice}
        </div>
      )}
      {showSetup && (
        <ModelSetupOverlay
          onDismiss={() => {
            localStorage.setItem('noetica:setup:skipped', '1')
            setShowSetup(false)
          }}
        />
      )}
      {showCitizenOnboarding && !showSetup && !providerSetupOpen && (
        <CitizenOnboardingWizard
          onComplete={(name, firstPrompt) => {
            setShowCitizenOnboarding(false)
            if (name) updateSettings({ userName: name })
            // Land the user on a REAL first answer (badge + Export Proof) instead of an empty chat.
            if (firstPrompt) { setActiveSurface('chat'); setTimeout(() => void handleSend(firstPrompt, []), 50) }
          }}
        />
      )}
      {showOrgOnboarding && !showCitizenOnboarding && !showSetup && !providerSetupOpen && (
        <OrgOnboardingWizard
          onComplete={() => setShowOrgOnboarding(false)}
        />
      )}
      <main className="flex h-screen overflow-hidden bg-[var(--color-background-tertiary)] text-[var(--color-text-primary)]">
        {/* Tier 1 — command-center (domain) switcher. Low-frequency nav: toggle with ⌘⇧\, hidden in focus. */}
        {!railCollapsed && !focusMode && (
          <CommandCenterRail activeCenter={activeCenter} onCenterChange={handleCenterChange} />
        )}
        {!sidebarCollapsed && !focusMode && (
          <div className="relative hidden h-full shrink-0 lg:flex" style={{ width: leftPanel.width }}>
            <Sidebar
              activeSurface={activeSurface}
              activeCenter={activeCenter}
              onSurfaceChange={handleSurfaceChange}
              onOpenSettings={(cat) => openSettings(cat)}
              sessions={sessions}
              activeSessionId={activeSession?.id ?? null}
              onSwitchSession={handleSwitchSession}
              onRemoveSession={removeSession}
              onNewChat={handleNewChat}
              onCollapse={() => setSidebarCollapsed(true)}
              density={settings.sidebarDensity}
            />
            <ResizeHandle resizable={leftPanel} ariaLabel="Resize sidebar" />
          </div>
        )}
        {sidebarCollapsed && !focusMode && (
          <CollapsedRail
            activeSurface={activeSurface}
            activeCenter={activeCenter}
            onSurfaceChange={handleSurfaceChange}
            onExpand={() => setSidebarCollapsed(false)}
          />
        )}

        <section className="flex min-w-0 flex-1 flex-col">
          <Topbar
            modelId={modelId}
            mode={mode}
            riskReadout={riskReadout}
            isLive={isLive}
            onLiveStart={startLive}
            onLiveStop={stopLive}
            openaiApiKey={settings.openaiApiKey || undefined}
            hasMessages={messages.filter((m) => m.role !== 'system').length > 0}
            activeSession={activeSession}
            onSetVisibility={setSessionVisibility}
            onModeChange={setMode}
            onModelChange={handleModelChange}
            onOpenSettings={(cat) => openSettings(cat)}
            onOpenPalette={() => setPaletteOpen(true)}
            onOpenInspector={() => setInspectorVisible(true)}
            onExportConversation={exportConversation}
            onRealtimeTranscript={(text) => void handleSendRaw(text, [], messages)}
            onRealtimeSpeechStart={stopSpeaking}
          />

          <div className="flex min-h-0 flex-1 overflow-hidden">
            <div className="flex min-h-0 flex-1 overflow-hidden">
              <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
              <SurfaceErrorBoundary key={activeSurface} surface={activeSurface}>
              <CenterWorkspace
                activeSurface={activeSurface}
                sessionId={activeSession?.id}
                activeProjectTitle={activeProject?.title}
                projectCollection={activeProject ? projectCollectionId(activeProject.id) : undefined}
                chatCollection={activeSession ? chatCollectionId(activeSession.id) : undefined}
                projects={projects.map((p) => ({ id: p.id, title: p.title }))}
                activeProjectId={activeProjectId}
                onSelectProject={setActiveProject}
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
                onResume={handleResume}
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
                onAtomSelect={(query) => { setActiveSurface('chat'); void handleSend(query, []) }}
                onOpenSettings={() => openSettings('connections')}
                onNavigateToOperate={() => setActiveSurface('operate')}
                onNavigateToGovern={() => setActiveSurface('govern')}
                onSpeak={(content, id) => { if (id && speakingId === id) stopSpeaking(); else void speak(content, id) }}
                speakingMessageId={speakingId}
                onFeedback={(messageId, rating) => {
                  void fetch(amUrl('/api/learning/feedback'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ messageId, rating, sessionId: activeSession?.id }),
                  }).catch(() => { /* feedback is fire-and-forget */ })
                }}
                agentMode={settings.agentMode}
                onSetAgentMode={(mode) => updateSettings({ agentMode: mode })}
                onPlanApprove={handlePlanApprove}
                onPlanReject={handlePlanReject}
                onInspect={handleInspect}
                onStartDictation={startDictation}
                onStopDictation={stopListening}
                dictating={isDictating}
              />
              </SurfaceErrorBoundary>
              </div>
              {inspectorVisible && (
                <>
                  <ResizeHandle resizable={rightPanel} ariaLabel="Resize inspector" />
                <div className="relative hidden h-full shrink-0 overflow-hidden lg:block" style={{ width: rightPanel.width }}>
                  {/* Visible close — the inspector ("Open Observatory" target) was only dismissable via ⌘I. */}
                  <button
                    onClick={() => setInspectorVisible(false)}
                    title="Close inspector (⌘I)"
                    aria-label="Close inspector"
                    className="absolute right-2 top-2 z-20 flex h-6 w-6 items-center justify-center rounded-md text-[var(--color-text-tertiary)] transition hover:bg-[var(--color-background-tertiary)] hover:text-[var(--color-text-primary)]"
                  >
                    <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden><path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
                  </button>
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
                </div>
                </>
              )}
            </div>
          </div>
        </section>

        {!focusMode && (
          <UtilityRail
            activePanel={utilityPanel}
            onSelect={setUtilityPanel}
            inspectMessage={inspectMessage ?? latestAnswer}
            inScopeFiles={inScopeFiles}
            toolActivity={toolActivity}
            fileChanges={fileChanges}
          />
        )}
      </main>

      {providerSetupOpen && (
        <ProviderSetupModal
          onClose={() => {
            sessionStorage.setItem('noetica-provider-setup-dismissed', '1')
            setProviderSetupOpen(false)
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
        onToggleRail={() => setRailCollapsed((c) => !c)}
        onToggleFocus={() => setFocusMode((f) => !f)}
        onSetAgentMode={(mode) => updateSettings({ agentMode: mode })}
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
  activeCenter: CommandCenterId
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
  { id: 'chat',      label: 'Chat',         icon: <IconSm path="M2 3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H5l-3 2V3Z" /> },
  { id: 'canvas',    label: 'Canvas',       icon: <IconSm path="M3 2h8l2 2v9a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z" d2="M5 6h6M5 9h4" /> },
  { id: 'projects',  label: 'Projects',     icon: <IconSm path="M2 2h5v5H2zM9 2h5v5H9z" d2="M2 9h5v5H2zM9 11h6M12 8.5v5" /> },
  { id: 'artifacts', label: 'Artifacts',    icon: <IconSm path="M4 2h5l3 3v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z" d2="M9 2v3h3M6 8h4M6 11h3" /> },
  { id: 'evaluate',  label: 'Evaluate',     icon: <IconSm path="M2 9h3v5H2zM6.5 6h3v8h-3zM11 3h3v11h-3z" /> },
  { id: 'tune',      label: 'Tune & Train', icon: <IconSm path="M5 1v12M11 1v12" d2="M3 5h4M9 11h4" /> },
  { id: 'govern',    label: 'Govern',       icon: <IconSm path="M8 2 2 5v3c0 3 2.5 5.5 6 6.5 3.5-1 6-3.5 6-6.5V5L8 2z" d2="M5.5 8l2 2 3.5-3.5" /> },
  { id: 'holographme',  label: 'HolographMe',  icon: <IconSm path="M8 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM3 14c0-2.8 2.2-5 5-5s5 2.2 5 5" /> },
  { id: 'intelligence', label: 'Intelligence',  icon: <IconSm path="M8 2l1.5 4.5H14l-3.7 2.7 1.4 4.3L8 11l-3.7 2.5 1.4-4.3L2 6.5h4.5z" /> },
  { id: 'portfolio',    label: 'Portfolio',     icon: <IconSm path="M2 13 6 7l4 3 4-6" d2="M2 13h12" /> },
  { id: 'geo',          label: 'Geo',          icon: <IconSm path="M8 1a5 5 0 0 0-5 5c0 3.5 5 9 5 9s5-5.5 5-9a5 5 0 0 0-5-5z" d2="M8 4.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z" /> },
  { id: 'marketplace',  label: 'Marketplace',  icon: <IconSm path="M2 5h12l-1.5 7H3.5L2 5z" d2="M5 5V3.5a3 3 0 0 1 6 0V5" /> },
]

// id → glyph lookup (from the list above), with a generic fallback for surfaces without a dedicated icon.
const SURFACE_ICON = new Map(surfaceIcons.map((s) => [s.id, s.icon]))
const FALLBACK_SURFACE_ICON = <IconSm path="M3 3h10v10H3z" d2="M6 6h4M6 9h4" />

function CollapsedRail({ activeSurface, activeCenter, onSurfaceChange, onExpand }: CollapsedRailProps) {
  // Show the ACTIVE command center's surfaces — not a fixed workspace list. Previously this rail was
  // hardcoded, so switching to Cloud/Data/etc still showed the chat surfaces. Mirror the expanded Sidebar.
  const surfaces = surfacesFor(activeCenter).filter((s) => s.tier === 'primary' || s.tier === 'secondary')
  return (
    <aside className="titlebar-inset hidden w-14 shrink-0 flex-col items-center border-r border-[var(--color-border-tertiary)] bg-[var(--color-background-tertiary)] py-3 lg:flex">
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
        {surfaces.map((s) => (
          <button
            key={s.id}
            onClick={() => onSurfaceChange(s.id as ActiveSurface)}
            title={s.label}
            className={`flex h-8 w-8 items-center justify-center rounded-lg transition ${
              activeSurface === s.id
                ? 'bg-[var(--color-accent-bg)] text-[var(--color-accent)]'
                : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-background-primary)] hover:text-[var(--color-text-primary)]'
            }`}
          >
            {SURFACE_ICON.get(s.id as ActiveSurface) ?? FALLBACK_SURFACE_ICON}
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
  onSend: (content: string, attachments: PendingAttachment[], mcpTools?: string[], scope?: { retrievalScope: RetrievalScope; web: boolean }) => Promise<void>
  activeProjectTitle?: string
  projectCollection?: string
  chatCollection?: string
  projects?: Array<{ id: string; title: string }>
  activeProjectId?: string | null
  onSelectProject?: (id: string) => void
  onFanout: (content: string, attachments: PendingAttachment[]) => Promise<void>
  onStop: () => void
  sessionId?: string
  onRegenerate: () => void
  onResume: () => void
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
  onAtomSelect?: (query: string) => void
  onOpenSettings?: () => void
  onNavigateToOperate?: () => void
  onNavigateToGovern?: () => void
  onSpeak?: (content: string, id?: string) => void
  speakingMessageId?: string | null
  onFeedback?: (messageId: string, rating: 'up' | 'down') => void
  agentMode?: 'auto' | 'plan' | 'ask'
  onSetAgentMode?: (mode: 'auto' | 'plan' | 'ask') => void
  onPlanApprove?: (messageId: string) => void
  onPlanReject?: (messageId: string) => void
  onInspect?: (message: ChatMessage) => void
  onStartDictation?: () => void
  onStopDictation?: () => void
  dictating?: boolean
}

function CenterWorkspace({ activeSurface, sessionId, activeProjectTitle, projectCollection, chatCollection, projects, activeProjectId, onSelectProject, messages, isStreaming, workspaceMode, fanoutModelCount, modelId, thinkingBudget, onSend, onFanout, onStop, onRegenerate, onResume, onFork, onEdit, onRecombine, onWorkspaceModeChange, onExtractArtifact, onModelChange, onOpenPalette, mcpTools, systemPrompt, onSystemPromptChange, activeArtifact, onCloseArtifact, onArtifactUpdate, onArtifactDelete, onAtomSelect, onOpenSettings, onNavigateToOperate, onNavigateToGovern, onSpeak, speakingMessageId, onFeedback, agentMode, onSetAgentMode, onPlanApprove, onPlanReject, onInspect, onStartDictation, onStopDictation, dictating }: CenterProps) {
  if (activeSurface === 'notes')        return <NotesSurface />
  if (activeSurface === 'canvas')       return <CanvasSurface />
  if (activeSurface === 'workrooms')    return <TabbedWorkspace tabs={[
    { id: 'workrooms', label: 'Rooms', render: () => <WorkroomsSurface thinkingBudget={thinkingBudget} /> },
    { id: 'jitsi', label: 'Video', render: () => <JitsiSurface /> },
  ]} />
  if (activeSurface === 'cowork')       return <CoworkSurface thinkingBudget={thinkingBudget} />
  if (activeSurface === 'projects')     return <ProjectsPanel />
  if (activeSurface === 'artifacts')    return <ArtifactsSurface />
  if (activeSurface === 'code')         return <CodeSurface onOpenSettings={onOpenSettings} onNavigateToOperate={onNavigateToOperate} />
  if (activeSurface === 'deploy')       return <DeploySurface />
  if (activeSurface === 'terminal')     return <TerminalSurface />
  if (activeSurface === 'search')       return <SearchSurface />
  if (activeSurface === 'services')     return <ServicesSurface />
  if (activeSurface === 'pipelines')    return <PipelinesSurface />
  if (activeSurface === 'labs')         return <LabsSurface />
  if (activeSurface === 'kg')           return <KnowledgeGraphSurface />
  if (activeSurface === 'workspace')    return <WorkspaceSurface />
  if (activeSurface === 'evaluate')     return <EvaluateSurface thinkingBudget={thinkingBudget} />
  if (activeSurface === 'studio')       return <TabbedWorkspace tabs={[
    { id: 'studio', label: 'Prompt & Compare', render: () => <StudioSurface /> },
    { id: 'rag', label: 'RAG', render: () => <RagInspectSurface /> },
    { id: 'lab', label: 'Capabilities', render: () => <LabSurface /> },
    { id: 'alignment', label: 'Alignment', render: () => <AlignmentSurface onNavigateToGovern={onNavigateToGovern} /> },
  ]} />
  if (activeSurface === 'rag')          return <RagInspectSurface />
  if (activeSurface === 'lab')          return <LabSurface />
  if (activeSurface === 'platform')     return <TabbedWorkspace tabs={[
    { id: 'broker', label: 'Cloud Broker', render: () => <CloudBrokerSurface /> },
    { id: 'marketplace', label: 'Marketplace', render: () => <MarketplaceSurface /> },
    { id: 'geo', label: 'Geo', render: () => <GeoSurface /> },
    { id: 'holographme', label: 'HolographMe', render: () => <HolographMeSurface /> },
  ]} />
  if (activeSurface === 'broker')       return <CloudBrokerSurface />
  if (activeSurface === 'alignment')    return <AlignmentSurface onNavigateToGovern={onNavigateToGovern} />
  if (activeSurface === 'agents')       return <AgentBuilderSurface />
  if (activeSurface === 'library')      return <LibrarySurface />
  if (activeSurface === 'intelligence') return <IntelligenceSurface />
  if (activeSurface === 'portfolio')    return <PortfolioSurface />
  if (activeSurface === 'geo')          return <GeoSurface />
  if (activeSurface === 'calendar')     return <CalendarSurface />
  if (activeSurface === 'jitsi')        return <JitsiSurface />
  if (activeSurface === 'docs')         return <OfficeViewer />
  if (activeSurface === 'operate')      return <TabbedWorkspace tabs={[
    { id: 'operate', label: 'Operate', render: () => <OperateSurface onAtomSelect={onAtomSelect} /> },
    { id: 'computer', label: 'Computer Use', render: () => <ComputerUseSurface /> },
  ]} />
  if (activeSurface === 'govern') {
    const traces = messages
      .filter((m) => m.role === 'assistant' && m.governance)
      .map((m) => ({ messageId: m.id, content: m.content.slice(0, 80), governance: m.governance! }))
    return <GovernSurface recentTraces={traces} />
  }
  if (activeSurface === 'tune')         return <TuneSurface thinkingBudget={thinkingBudget} />
  if (activeSurface === 'computer')     return <ComputerUseSurface />
  if (activeSurface === 'holographme')  return <HolographMeSurface />
  if (activeSurface === 'marketplace')  return <MarketplaceSurface />

  return (
    <div className={`grid min-h-0 flex-1 overflow-hidden transition-[grid-template-columns] duration-300 ${activeArtifact ? 'grid-cols-[minmax(320px,1fr)_480px]' : 'grid-cols-1'}`}>
      <section className="flex min-h-0 flex-col overflow-hidden">
        <GoalBanner sessionId={sessionId} />
        <MessageList messages={messages} isStreaming={isStreaming} onExtractArtifact={onExtractArtifact} onRegenerate={onRegenerate} onResume={onResume} onFork={onFork} onEdit={onEdit} onRecombine={onRecombine} onSpeak={onSpeak} speakingMessageId={speakingMessageId} onQuickPrompt={(t) => onSend(t, [])} onFeedback={onFeedback} onPlanApprove={onPlanApprove} onPlanReject={onPlanReject} onInspect={onInspect} />
        {agentMode && agentMode !== 'auto' && (
          <div className="mx-4 mb-1 flex items-center gap-2 rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] px-3 py-1.5 text-xs">
            {agentMode === 'plan' ? (
              <span className="font-semibold text-[#7c3aed]">Plan mode</span>
            ) : (
              <span className="font-semibold text-[var(--color-attention)]">Ask mode</span>
            )}
            <span className="text-[var(--color-text-tertiary)]">
              {agentMode === 'plan' ? '— agent will outline a step-plan before acting' : '— agent will ask before using tools'}
            </span>
            <button
              onClick={() => onSetAgentMode?.('auto')}
              className="ml-auto text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]"
              title="Return to Auto mode"
              aria-label="Dismiss plan mode"
            >
              ✕
            </button>
          </div>
        )}
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
          activeProjectTitle={activeProjectTitle}
          projectCollection={projectCollection}
          projects={projects}
          activeProjectId={activeProjectId}
          onSelectProject={onSelectProject}
          chatCollection={chatCollection}
          onStartDictation={onStartDictation}
          onStopDictation={onStopDictation}
          dictating={dictating}
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
          {badge && <span className="rounded-md bg-[var(--color-background-secondary)] px-2 py-0.5 text-[11px] font-medium text-[var(--color-text-secondary)]">{badge}</span>}
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
  if (activeSurface === 'library')   return null
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
