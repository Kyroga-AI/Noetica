'use client'

import { useEffect, useRef, useState } from 'react'
import { useWorkrooms } from '@/lib/workrooms/useWorkrooms'
import { useSettings } from '@/lib/settings/context'
import { useConnectorAuth } from '@/lib/auth/context'
import { sendNoeticaChat } from '@/lib/client/noeticaTransport'
import { amUrl } from '@/lib/tauri/bridge'
import type { Workroom, WorkroomMessage, AgentDispatch } from '@/lib/types/workroom'
import { AGENT_ARCHETYPES } from '@/lib/types/workroom'
import type { ChatMessage } from '@/lib/types/message'
import {
  fetchSlackChannels,
  fetchSlackChannelHistory,
  fetchSlackUserNames,
  type SlackChannel,
  type SlackMessage,
} from '@/lib/auth/providers/slack'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const d = Date.now() - new Date(iso).getTime()
  const m = Math.floor(d / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d`
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

// Deterministic avatar color from participant name
const AVATAR_COLORS = [
  'bg-[var(--accent)]', 'bg-[#7c3aed]', 'bg-[#0891b2]',
  'bg-[#059669]', 'bg-[#d97706]', 'bg-[#dc2626]',
]
function avatarColor(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) & 0xffff
  return AVATAR_COLORS[hash % AVATAR_COLORS.length]
}
function avatarColorRaw(name: string): string {
  const colors = ['var(--accent)', '#7c3aed', '#0891b2', '#059669', '#d97706', '#dc2626']
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) & 0xffff
  return colors[hash % colors.length]
}
function initials(name: string): string {
  return name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()
}

// Random word list for Jitsi room names
const RANDOM_WORDS = [
  'alpha', 'bravo', 'cedar', 'delta', 'ember', 'frost', 'grove', 'haven',
  'ivory', 'jewel', 'karma', 'lunar', 'maple', 'noble', 'orbit', 'pearl',
  'quartz', 'river', 'solar', 'terra', 'unity', 'vivid', 'waves', 'xenon',
]
function randomWord(): string {
  return RANDOM_WORDS[Math.floor(Math.random() * RANDOM_WORDS.length)]
}

// ─── Dispatchable agents: the 5 built-in archetypes + custom agents from Agent Builder ────
// Unifies the two previously-separate rosters (workroom.ts's AGENT_ARCHETYPES vs the
// agent-machine registry behind /api/agents) into one list Workrooms can select and dispatch
// from, so an agent built in Agent Builder is usable here too — not just via dispatch_agent.
interface DispatchAgent {
  id: string
  name: string
  description: string
  systemPrompt: string
  color: string
  tags: string[]
  custom?: boolean
}
interface CustomAgentSummary {
  id: string; label: string; description: string; systemPrompt: string
  tools: string[]; maxTurns: number; model?: 'coder' | 'general'
}

function toDispatchAgent(a: (typeof AGENT_ARCHETYPES)[number]): DispatchAgent {
  return { id: a.id, name: a.name, description: a.description, systemPrompt: a.systemPrompt, color: a.color, tags: a.tags }
}
function customToDispatchAgent(a: CustomAgentSummary): DispatchAgent {
  return { id: a.id, name: a.label, description: a.description, systemPrompt: a.systemPrompt, color: avatarColor(a.label), tags: ['custom'], custom: true }
}

// ─── Room list ────────────────────────────────────────────────────────────────

function RoomListItem({ room, active, onClick }: { room: Workroom; active: boolean; onClick: () => void }) {
  const last = room.messages[room.messages.length - 1]
  return (
    <button onClick={onClick}
      className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left transition ${active ? 'bg-[var(--accent-soft)]' : 'hover:bg-[var(--color-background-tertiary)]'}`}>
      {/* Room avatar */}
      <div
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] text-[11px] font-bold text-white"
        style={{ backgroundColor: avatarColorRaw(room.name) }}
      >
        {room.name.charAt(0).toUpperCase()}
      </div>
      {/* Text column */}
      <div className="min-w-0 flex-1">
        <span className={`block truncate text-sm font-medium ${active ? 'text-[var(--accent)]' : 'text-[var(--color-text-primary)]'}`}>
          {room.name}
        </span>
        <p className="truncate text-xs text-[var(--color-text-tertiary)]">
          {last ? `${last.participantName}: ${last.content.slice(0, 45)}` : room.description || 'No messages yet'}
        </p>
      </div>
    </button>
  )
}

// ─── Chat message row ─────────────────────────────────────────────────────────

function MessageRow({ msg, agents }: { msg: WorkroomMessage; agents: DispatchAgent[] }) {
  if (msg.kind === 'system') {
    return (
      <div className="flex justify-center py-1">
        <span className="rounded-full bg-[var(--color-background-tertiary)] px-3 py-0.5 text-[11px] italic text-[var(--color-text-tertiary)]">
          {msg.content}
        </span>
      </div>
    )
  }

  if (msg.kind === 'dispatch') {
    return (
      <div className="flex justify-center py-1">
        <div className="rounded-xl border border-[var(--accent)] bg-[var(--accent-soft)] px-4 py-2 text-xs">
          <span className="font-semibold text-[var(--accent)]">→ Dispatched to {msg.participantName}</span>
          <p className="mt-0.5 text-[var(--color-text-secondary)]">{msg.content}</p>
        </div>
      </div>
    )
  }

  const isUser = msg.participantId === 'user'

  return (
    <div className={`flex items-start gap-2.5 ${isUser ? 'flex-row-reverse' : ''}`}>
      {/* Avatar */}
      <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white ${
        msg.participantKind === 'agent'
          ? (agents.find((a) => a.name === msg.participantName)?.color ?? 'bg-[#64748b]')
          : msg.participantKind === 'system'
          ? 'bg-[#0f172a]'
          : avatarColor(msg.participantName)
      }`}>
        {msg.participantKind === 'system' ? 'N' : initials(msg.participantName)}
      </div>

      {/* Bubble */}
      <div className={`max-w-[72%] space-y-0.5 ${isUser ? 'items-end' : 'items-start'} flex flex-col`}>
        <div className="flex items-baseline gap-2">
          {!isUser && <span className="text-[11px] font-semibold text-[var(--color-text-secondary)]">{msg.participantName}</span>}
          <span className="text-[10px] text-[#cbd5e1]">{formatTime(msg.createdAt)}</span>
          {isUser && <span className="text-[11px] font-semibold text-[var(--color-text-secondary)]">{msg.participantName}</span>}
        </div>
        <div className={`rounded-2xl px-3.5 py-2.5 text-sm leading-6 ${
          isUser
            ? 'bg-[var(--accent-soft)] text-[var(--color-text-primary)]'
            : msg.participantKind === 'agent'
            ? 'border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] text-[var(--color-text-primary)] shadow-sm'
            : 'bg-[var(--color-background-tertiary)] text-[var(--color-text-primary)]'
        }`}>
          <p className="whitespace-pre-wrap">{msg.content}</p>
        </div>
      </div>
    </div>
  )
}

// ─── Agent dispatch panel ─────────────────────────────────────────────────────

function AgentDispatchPanel({ room, agents, onDispatch }: {
  room: Workroom
  agents: DispatchAgent[]
  onDispatch: (agentId: string, task: string) => Promise<void>
}) {
  const [selectedAgents, setSelectedAgents] = useState<Set<string>>(new Set())
  const [task, setTask] = useState('')

  function toggleAgent(agentId: string) {
    setSelectedAgents((prev) => {
      const next = new Set(prev)
      if (next.has(agentId)) next.delete(agentId)
      else next.add(agentId)
      return next
    })
  }

  function handleDispatch() {
    if (selectedAgents.size === 0 || !task.trim()) return
    const ids = [...selectedAgents]
    const taskText = task.trim()
    // Clear immediately — each dispatch streams independently in the background
    setSelectedAgents(new Set())
    setTask('')
    for (const id of ids) {
      void onDispatch(id, taskText)
    }
  }

  const canDispatch = selectedAgents.size > 0 && task.trim().length > 0
  const dispatchLabel = selectedAgents.size > 1
    ? `Dispatch to ${selectedAgents.size} agents`
    : selectedAgents.size === 1
    ? `Dispatch to ${agents.find((a) => a.id === [...selectedAgents][0])?.name ?? 'agent'}`
    : 'Select agents above'

  return (
    <div className="flex w-[250px] shrink-0 flex-col border-l border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)]">
      {/* Header */}
      <div className="border-b border-[var(--color-border-secondary)] px-4 py-3">
        <p className="text-xs font-semibold text-[var(--color-text-primary)]">Dispatch agents</p>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
        {/* Flat agent list */}
        {agents.map((arch) => {
          const isSelected = selectedAgents.has(arch.id)
          return (
            <button key={arch.id} onClick={() => toggleAgent(arch.id)}
              className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition ${
                isSelected ? 'bg-[var(--accent-soft)]' : 'hover:bg-[var(--color-background-tertiary)]'
              }`}>
              {/* Small colored dot */}
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: arch.color.startsWith('bg-[') ? arch.color.slice(4, -1) : undefined }}
              />
              {/* Name + description */}
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium text-[var(--color-text-primary)]">{arch.name}</p>
                <p className="truncate text-[11px] text-[var(--color-text-tertiary)]">{arch.description}</p>
              </div>
              {/* Checkbox */}
              <div className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border transition ${
                isSelected ? 'border-[var(--accent)] bg-[var(--accent)]' : 'border-[#cbd5e1] bg-transparent'
              }`}>
                {isSelected && (
                  <svg width="8" height="8" viewBox="0 0 9 9" fill="none" aria-hidden>
                    <path d="M1.5 4.5l2 2 4-4" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                )}
              </div>
            </button>
          )
        })}
      </div>

      {/* Dispatch form — always visible */}
      <div className="border-t border-[var(--color-border-secondary)] p-3 space-y-2">
        <textarea
          className="w-full resize-none rounded-[9px] border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] px-3 py-2 text-xs leading-5 text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--accent)]"
          placeholder="Describe the task for selected agents..."
          rows={4}
          value={task}
          onChange={(e) => setTask(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleDispatch() }}
        />
        <button onClick={handleDispatch}
          disabled={!canDispatch}
          className="w-full rounded-xl bg-[var(--accent)] py-2 text-xs font-semibold text-white transition hover:bg-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-40">
          {dispatchLabel}
        </button>
        <p className="text-[10px] leading-[14px] text-[var(--color-text-tertiary)]">
          Selected agents each get a parallel, independent request — they see the last 20 room messages as context.
        </p>
      </div>
    </div>
  )
}

// ─── Room view ────────────────────────────────────────────────────────────────

const YOU: WorkroomMessage['participantId'] = 'user'

function RoomView({ room, agents, thinkingBudget, onAppendMessage, onUpdateMessage, onUpdateDispatch, onAddParticipant }: {
  room: Workroom
  agents: DispatchAgent[]
  thinkingBudget?: number
  onAppendMessage: (msg: WorkroomMessage) => void
  onUpdateMessage: (msgId: string, patch: Partial<WorkroomMessage>) => void
  onUpdateDispatch: (dispatch: AgentDispatch) => void
  onAddParticipant: (participant: import('@/lib/types/workroom').WorkroomParticipant) => void
}) {
  const { settings } = useSettings()
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const activeAbortsRef = useRef<Set<AbortController>>(new Set())

  // Abort all in-flight dispatches on unmount
  useEffect(() => () => { activeAbortsRef.current.forEach((a) => a.abort()) }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [room.messages.length])

  function providerKeys() {
    return {
      anthropic:   settings.anthropicApiKey   || undefined,
      openai:      settings.openaiApiKey      || undefined,
      google:      settings.googleApiKey      || undefined,
      mistral:     settings.mistralApiKey     || undefined,
      neuronpedia: settings.neuronpediaApiKey || undefined,
      openrouter:  settings.openrouterApiKey  || undefined,
      huggingface: settings.huggingfaceApiKey || undefined,
    }
  }

  async function sendChat() {
    const trimmed = input.trim()
    if (!trimmed || sending) return
    setSending(true)
    setInput('')

    const userMsg: WorkroomMessage = {
      id: crypto.randomUUID(), participantId: YOU,
      participantName: 'You', participantKind: 'human',
      kind: 'chat', content: trimmed, createdAt: new Date().toISOString(),
    }
    onAppendMessage(userMsg)
    setSending(false)
  }

  async function dispatchToAgent(agentId: string, task: string) {
    const arch = agents.find((a) => a.id === agentId)
    if (!arch) return

    // Ensure agent is in participants — auto-add if dispatching to an inactive agent
    const alreadyIn = room.participants.some((p) => p.agentId === agentId)
    if (!alreadyIn) {
      onAddParticipant({ id: agentId, name: arch.name, kind: 'agent', agentId, joinedAt: new Date().toISOString() })
    }

    // Add dispatch message to thread
    const dispatchMsg: WorkroomMessage = {
      id: crypto.randomUUID(), participantId: YOU,
      participantName: 'You', participantKind: 'human',
      kind: 'dispatch', content: task,
      dispatchTask: task, createdAt: new Date().toISOString(),
    }
    onAppendMessage(dispatchMsg)

    const dispatch: AgentDispatch = {
      id: crypto.randomUUID(), agentId, agentName: arch.name,
      task, status: 'running', dispatchedAt: new Date().toISOString(),
    }
    onUpdateDispatch(dispatch)

    // Build conversation context from recent room messages
    const recentMessages: ChatMessage[] = room.messages.slice(-20).map((m) => ({
      id: m.id, role: m.participantKind === 'human' ? 'user' as const : 'assistant' as const,
      content: m.participantKind === 'human' ? m.content : `[${m.participantName}]: ${m.content}`,
      created_at: m.createdAt,
    }))

    const systemMsg: ChatMessage = {
      id: 'agent-system', role: 'system',
      content: `${arch.systemPrompt}\n\nYou are operating inside a workroom called "${room.name}"${room.description ? `: ${room.description}` : ''}. Respond directly to the task dispatched to you.`,
      created_at: new Date().toISOString(),
    }
    const taskMsg: ChatMessage = {
      id: crypto.randomUUID(), role: 'user',
      content: `Task dispatched to you: ${task}`,
      created_at: new Date().toISOString(),
    }

    const resultMsgId = crypto.randomUUID()
    const resultMsg: WorkroomMessage = {
      id: resultMsgId, participantId: agentId,
      participantName: arch.name, participantKind: 'agent',
      kind: 'result', content: '', dispatchRef: dispatchMsg.id,
      createdAt: new Date().toISOString(),
    }
    onAppendMessage(resultMsg)

    // Stream response — update the result message slot in place rather than appending
    const abort = new AbortController()
    activeAbortsRef.current.add(abort)

    let fullContent = ''
    try {
      await sendNoeticaChat(
        {
          session_id: `workroom:${room.id}:dispatch:${dispatch.id}`,
          mode: 'standalone',
          model_id: settings.defaultModelId,
          messages: [systemMsg, ...recentMessages, taskMsg],
          memory_scope: `noetica-workroom:${room.id}`,
          provider_keys: providerKeys(),
          thinking_budget: thinkingBudget,
          agent_machine_endpoint:
            settings.runtimeMode === 'agent-machine' ? settings.agentMachineEndpoint : undefined,
        },
        {
          onMeta: () => {},
          onDelta: (delta) => {
            fullContent += delta
            onUpdateMessage(resultMsgId, { content: fullContent })
          },
          onThinkingDelta: () => {},
          onDone: (result) => {
            onUpdateMessage(resultMsgId, { content: result.content })
            onUpdateDispatch({ ...dispatch, status: 'done', completedAt: new Date().toISOString(), messageId: resultMsgId })
          },
          onError: (err) => {
            onUpdateMessage(resultMsgId, { content: `Error: ${err}` })
            onUpdateDispatch({ ...dispatch, status: 'error', completedAt: new Date().toISOString() })
          },
        },
        {},
        abort.signal
      )
    } catch (e) {
      if (!(e instanceof DOMException && (e as DOMException).name === 'AbortError')) {
        onUpdateMessage(resultMsgId, { content: 'Error: request failed' })
        onUpdateDispatch({ ...dispatch, status: 'error', completedAt: new Date().toISOString() })
      }
    } finally {
      activeAbortsRef.current.delete(abort)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      {/* Chat column */}
      <div className="flex min-h-0 flex-1 flex-col">
        {/* Room header */}
        <div className="flex items-center gap-3 border-b border-[var(--color-border-secondary)] px-6 py-3">
          {/* Room avatar in header */}
          <div
            className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[8px] text-[12px] font-bold text-white"
            style={{ backgroundColor: avatarColorRaw(room.name) }}
          >
            {room.name.charAt(0).toUpperCase()}
          </div>
          <div>
            <p className="text-sm font-semibold text-[var(--color-text-primary)]">{room.name}</p>
            {room.description && (
              <p className="text-xs text-[var(--color-text-tertiary)]">{room.description}</p>
            )}
          </div>
          {/* Participant count pill */}
          <div className="ml-auto shrink-0 rounded-full border border-[var(--color-border-secondary)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--color-text-secondary)]">
            {room.participants.length} participant{room.participants.length !== 1 ? 's' : ''}
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
          {room.messages.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center py-20 text-center">
              <span className="text-[40px]">💬</span>
              <p className="mt-3 text-sm text-[var(--color-text-tertiary)]">
                Room is open. Chat freely, or dispatch agents from the panel →
              </p>
            </div>
          ) : (
            room.messages.map((msg) => <MessageRow key={msg.id} msg={msg} agents={agents} />)
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="border-t border-[var(--color-border-secondary)] px-6 py-4">
          <div className="flex items-end gap-3 rounded-2xl border border-[var(--accent)] bg-[var(--color-background-primary)] px-4 py-3 shadow-sm">
            <textarea
              className="min-h-[2.5rem] flex-1 resize-none bg-transparent text-sm leading-6 text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-tertiary)]"
              placeholder="Write something to the room... (agents don't reply unless dispatched)"
              value={input}
              disabled={sending}
              onChange={(e) => setInput(e.target.value)}
              rows={2}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void sendChat() }}
            />
            <button onClick={() => void sendChat()}
              disabled={!input.trim() || sending}
              className="shrink-0 rounded-xl bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50">
              {sending ? '...' : 'Send'}
            </button>
          </div>
        </div>
      </div>

      {/* Agent dispatch column */}
      <AgentDispatchPanel room={room} agents={agents} onDispatch={dispatchToAgent} />
    </div>
  )
}

// ─── Slack channel view ───────────────────────────────────────────────────────

function fmtSlackTs(ts: string): string {
  const d = new Date(parseFloat(ts) * 1000)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

function SlackChannelView({ channel, token }: { channel: SlackChannel; token: string }) {
  const [messages, setMessages] = useState<SlackMessage[]>([])
  const [userNames, setUserNames] = useState<Map<string, string>>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setLoading(true)
    setError('')
    fetchSlackChannelHistory(token, channel.id)
      .then(async (msgs) => {
        const ids = msgs.map((m) => m.userId)
        const names = await fetchSlackUserNames(token, ids)
        setMessages([...msgs].reverse())
        setUserNames(names)
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed to load channel'))
      .finally(() => setLoading(false))
  }, [channel.id, token])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  function resolveUser(msg: SlackMessage): string {
    return userNames.get(msg.userId) ?? msg.userName ?? msg.userId
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-[var(--color-border-secondary)] px-6 py-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-[var(--color-text-primary)]">
              {channel.isPrivate ? '🔒' : '#'}{channel.name}
            </span>
            <span className="rounded-full bg-[#f5f0ff] px-2 py-0.5 text-[9px] font-semibold text-[#7c3aed]">Slack</span>
          </div>
          <p className="text-xs text-[var(--color-text-tertiary)]">
            {channel.numMembers} members{channel.topic ? ` · ${channel.topic}` : ''}
          </p>
        </div>
        <div className="ml-auto text-[10px] text-[var(--color-text-tertiary)]">Read-only — post from Slack</div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
        {loading ? (
          <div className="space-y-3">
            {[1,2,3,4].map((i) => (
              <div key={i} className="flex items-start gap-2.5">
                <div className="h-7 w-7 shrink-0 animate-pulse rounded-full bg-[var(--color-background-tertiary)]" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3 w-24 animate-pulse rounded bg-[var(--color-background-tertiary)]" />
                  <div className="h-10 animate-pulse rounded-xl bg-[var(--color-background-tertiary)]" />
                </div>
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="rounded-xl border border-[#fecaca] bg-[#fef2f2] px-4 py-3 text-xs text-[#dc2626]">
            {error}
            {error.includes('not_in_channel') && (
              <p className="mt-1 text-[11px] text-[#dc2626]/70">The bot needs to be invited to #{channel.name} in Slack first.</p>
            )}
          </div>
        ) : messages.length === 0 ? (
          <div className="py-10 text-center text-xs text-[var(--color-text-tertiary)]">No messages in this channel.</div>
        ) : (
          messages.map((msg) => {
            const name = resolveUser(msg)
            return (
              <div key={msg.ts} className="flex items-start gap-2.5">
                <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white ${avatarColor(name)}`}>
                  {initials(name)}
                </div>
                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="flex items-baseline gap-2">
                    <span className="text-[11px] font-semibold text-[var(--color-text-secondary)]">{name}</span>
                    <span className="text-[10px] text-[#cbd5e1]">{fmtSlackTs(msg.ts)}</span>
                  </div>
                  <div className="rounded-2xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-3.5 py-2.5 text-sm leading-6 text-[var(--color-text-primary)] shadow-sm">
                    <p className="whitespace-pre-wrap">{msg.text}</p>
                    {msg.reactions && msg.reactions.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {msg.reactions.map((r) => (
                          <span key={r.name} className="rounded-full border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] px-2 py-0.5 text-[11px]">
                            :{r.name}: {r.count}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )
          })
        )}
        <div ref={bottomRef} />
      </div>

      {/* Footer note */}
      <div className="border-t border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] px-6 py-2.5 text-[11px] text-[var(--color-text-tertiary)]">
        Showing last 30 messages · Connected via Slack OAuth · Post replies from Slack
      </div>
    </div>
  )
}

// ─── New workroom form ────────────────────────────────────────────────────────

function NewRoomForm({ onCreate, onCancel }: { onCreate: (name: string, desc: string) => void; onCancel: () => void }) {
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  return (
    <div className="rounded-xl border border-[var(--accent)] bg-[var(--accent-soft)] p-4 space-y-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-[var(--accent)]">New Workroom</p>
      <div className="space-y-1">
        <label className="text-xs font-medium text-[var(--color-text-secondary)]">Name</label>
        <input className="w-full rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-3 py-1.5 text-sm outline-none focus:border-[var(--accent)]"
          placeholder="Team planning room" value={name} onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) onCreate(name, desc) }}
          autoFocus />
      </div>
      <div className="space-y-1">
        <label className="text-xs font-medium text-[var(--color-text-secondary)]">Description <span className="font-normal text-[var(--color-text-tertiary)]">(optional)</span></label>
        <input className="w-full rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-3 py-1.5 text-sm outline-none focus:border-[var(--accent)]"
          placeholder="What's this room for?" value={desc} onChange={(e) => setDesc(e.target.value)} />
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <button onClick={onCancel} className="rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-4 py-1.5 text-xs font-medium text-[var(--color-text-secondary)] transition hover:bg-[var(--color-background-tertiary)]">Cancel</button>
        <button onClick={() => { if (name.trim()) onCreate(name, desc) }}
          disabled={!name.trim()}
          className="rounded-lg bg-[var(--accent)] px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-[var(--accent)] disabled:opacity-50">
          Create
        </button>
      </div>
    </div>
  )
}

// ─── Video tab content ───────────────────────────────────────────────────────

function VideoTabContent() {
  const [roomName, setRoomName] = useState('')

  function generateRandom() {
    setRoomName(`noetica-${randomWord()}-${randomWord()}`)
  }

  function joinCall() {
    if (!roomName.trim()) return
    window.open(`https://meet.jit.si/${roomName.trim()}`, '_blank')
  }

  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="w-full max-w-sm rounded-2xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] p-8 text-center shadow-sm">
        <span className="text-[56px] leading-none">📷</span>
        <h2 className="mt-4 text-lg font-semibold text-[var(--color-text-primary)]">Video call</h2>
        <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
          Start or join a video call powered by Jitsi Meet. Enter a room name or generate a random one.
        </p>
        <div className="mt-5 flex items-center gap-2">
          <input
            className="flex-1 rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] px-3 py-2 text-sm outline-none placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--accent)]"
            placeholder="Room name"
            value={roomName}
            onChange={(e) => setRoomName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') joinCall() }}
          />
          <button
            onClick={generateRandom}
            className="shrink-0 rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] px-3 py-2 text-xs font-medium text-[var(--color-text-secondary)] transition hover:bg-[var(--color-background-tertiary)]"
          >
            Random
          </button>
        </div>
        <button
          onClick={joinCall}
          disabled={!roomName.trim()}
          className="mt-4 w-full rounded-xl bg-[var(--accent)] py-2.5 text-sm font-semibold text-white transition hover:bg-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          Join call
        </button>
      </div>
    </div>
  )
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
      <span className="text-[40px]">🏠</span>
      <p className="text-sm text-[var(--color-text-tertiary)]">Select or create a room to get started</p>
    </div>
  )
}

// ─── Main surface ─────────────────────────────────────────────────────────────

type ActiveView =
  | { kind: 'workroom'; id: string }
  | { kind: 'slack'; channel: SlackChannel }

export function WorkroomsSurface({ thinkingBudget }: { thinkingBudget?: number }) {
  const { hydrated, workrooms, createWorkroom, deleteWorkroom, addParticipant, appendMessage, updateMessage, updateDispatch } = useWorkrooms()
  const { store } = useConnectorAuth()
  const [active, setActive] = useState<ActiveView | null>(null)
  const [showNew, setShowNew] = useState(false)
  const [activeTab, setActiveTab] = useState<'workrooms' | 'video'>('workrooms')

  // Dispatchable roster: the 5 built-in archetypes + any custom agents from Agent Builder,
  // so an agent built there is usable in Workrooms too (previously only the 5 hardcoded
  // archetypes were selectable here — custom agents had no path into this surface).
  const [customAgents, setCustomAgents] = useState<CustomAgentSummary[]>([])
  useEffect(() => {
    void fetch(amUrl('/api/agents'))
      .then((r) => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then((d: { custom?: CustomAgentSummary[] }) => setCustomAgents(d.custom ?? []))
      .catch(() => {})   // Agent Builder's custom roster is additive — offline just means built-ins only
  }, [])
  const agents: DispatchAgent[] = [...AGENT_ARCHETYPES.map(toDispatchAgent), ...customAgents.map(customToDispatchAgent)]

  // Slack state
  const slackAuth = store.slack
  const slackConnected = slackAuth?.status === 'connected' && !!slackAuth.accessToken
  const [slackChannels, setSlackChannels] = useState<SlackChannel[]>([])
  const [slackLoading, setSlackLoading] = useState(false)
  const [slackExpanded, setSlackExpanded] = useState(true)

  useEffect(() => {
    if (!slackConnected || !slackAuth?.accessToken) { setSlackChannels([]); return }
    setSlackLoading(true)
    fetchSlackChannels(slackAuth.accessToken)
      .then((channels) => {
        setSlackChannels(channels.sort((a, b) => (b.unreadCount ?? 0) - (a.unreadCount ?? 0)))
        setSlackLoading(false)
      })
      .catch(() => setSlackLoading(false))
  }, [slackConnected, slackAuth?.accessToken])

  const activeRoom = active?.kind === 'workroom'
    ? workrooms.find((r) => r.id === active.id) ?? null
    : null
  const activeSlackChannel = active?.kind === 'slack' ? active.channel : null

  const filtered = workrooms

  function handleCreate(name: string, desc: string) {
    const room = createWorkroom(name, desc)
    setActive({ kind: 'workroom', id: room.id })
    setShowNew(false)
  }

  // Deduplicate streaming result messages
  const dedupedRoom = activeRoom
    ? {
        ...activeRoom,
        messages: activeRoom.messages.reduce<WorkroomMessage[]>((acc, msg) => {
          const idx = acc.findIndex((m) => m.id === msg.id)
          if (idx === -1) return [...acc, msg]
          const next = [...acc]; next[idx] = msg; return next
        }, []),
      }
    : null

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* ── Tab bar ── */}
      <div className="flex shrink-0 border-b border-[var(--color-border-secondary)]">
        <button
          onClick={() => setActiveTab('workrooms')}
          className={`px-5 py-2.5 text-sm transition ${
            activeTab === 'workrooms'
              ? 'border-b-2 border-[var(--accent)] font-bold text-[var(--accent)]'
              : 'font-normal text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]'
          }`}
        >
          Workrooms
        </button>
        <button
          onClick={() => setActiveTab('video')}
          className={`px-5 py-2.5 text-sm transition ${
            activeTab === 'video'
              ? 'border-b-2 border-[var(--accent)] font-bold text-[var(--accent)]'
              : 'font-normal text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]'
          }`}
        >
          Video
        </button>
      </div>

      {/* ── Tab content ── */}
      {activeTab === 'video' ? (
        <VideoTabContent />
      ) : (
        <div className="flex min-h-0 flex-1 overflow-hidden">
          {/* ── Room list ── */}
          <aside className="flex w-[210px] shrink-0 flex-col border-r border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)]">
            <div className="flex items-center justify-between border-b border-[var(--color-border-secondary)] px-3 py-3">
              <span className="text-xs font-semibold uppercase tracking-wide text-[var(--accent)]">Rooms</span>
              <button onClick={() => setShowNew(true)} title="New workroom"
                className="flex h-[22px] w-[22px] items-center justify-center rounded-[6px] bg-[var(--accent)] text-white transition hover:opacity-90">
                <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden>
                  <path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto">
              {/* Local workrooms */}
              <div className="px-2 py-1 space-y-0.5">
                {!hydrated && <p className="py-4 text-center text-xs text-[var(--color-text-tertiary)]">Loading...</p>}
                {hydrated && showNew && (
                  <div className="p-2">
                    <NewRoomForm onCreate={handleCreate} onCancel={() => setShowNew(false)} />
                  </div>
                )}
                {hydrated && filtered.length === 0 && !showNew && (
                  <p className="px-2 py-4 text-center text-xs text-[var(--color-text-tertiary)]">Create your first room</p>
                )}
                {filtered.map((room) => (
                  <RoomListItem key={room.id} room={room}
                    active={active?.kind === 'workroom' && active.id === room.id}
                    onClick={() => setActive({ kind: 'workroom', id: room.id })} />
                ))}
              </div>

              {/* Slack channels section */}
              {slackConnected && (
                <div className="mt-2">
                  <button
                    onClick={() => setSlackExpanded((v) => !v)}
                    className="flex w-full items-center gap-1.5 border-t border-[var(--color-border-secondary)] px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#7c3aed] transition hover:bg-[var(--color-background-secondary)]"
                  >
                    <svg width="8" height="8" viewBox="0 0 8 8" fill="none" className={`transition-transform ${slackExpanded ? 'rotate-90' : ''}`} aria-hidden>
                      <path d="M2 1l3 3-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                    Slack
                    {slackAuth?.userInfo?.name && <span className="ml-auto font-normal normal-case tracking-normal text-[var(--color-text-tertiary)]">{slackAuth.userInfo.name}</span>}
                  </button>
                  {slackExpanded && (
                    <div className="px-2 pb-1 space-y-0.5">
                      {slackLoading ? (
                        <p className="py-2 text-center text-[10px] text-[var(--color-text-tertiary)]">Loading channels...</p>
                      ) : slackChannels.length === 0 ? (
                        <p className="px-2 py-2 text-[10px] text-[var(--color-text-tertiary)]">No channels found.<br/>Invite the app to channels in Slack.</p>
                      ) : (
                        slackChannels.map((ch) => {
                          const isActive = active?.kind === 'slack' && active.channel.id === ch.id
                          return (
                            <button key={ch.id}
                              onClick={() => setActive({ kind: 'slack', channel: ch })}
                              className={`flex w-full items-center gap-1.5 rounded-xl px-3 py-2 text-left transition ${isActive ? 'bg-[#ede9fe]' : 'hover:bg-[var(--color-background-tertiary)]'}`}>
                              <span className={`shrink-0 text-xs ${isActive ? 'text-[#7c3aed]' : 'text-[var(--color-text-tertiary)]'}`}>
                                {ch.isPrivate ? '🔒' : '#'}
                              </span>
                              <span className={`truncate text-xs font-medium ${isActive ? 'text-[#7c3aed]' : 'text-[var(--color-text-primary)]'}`}>
                                {ch.name}
                              </span>
                              {(ch.unreadCount ?? 0) > 0 && (
                                <span className="ml-auto shrink-0 rounded-full bg-[#7c3aed] px-1.5 py-0.5 text-[9px] font-bold text-white">
                                  {ch.unreadCount}
                                </span>
                              )}
                            </button>
                          )
                        })
                      )}
                    </div>
                  )}
                </div>
              )}

              {!slackConnected && (
                <div className="border-t border-[var(--color-border-secondary)] px-3 py-2.5">
                  <p className="text-[10px] text-[var(--color-text-tertiary)]">
                    Connect Slack in Settings → Connections to see channels here.
                  </p>
                </div>
              )}
            </div>

            {hydrated && workrooms.length > 0 && (
              <div className="border-t border-[var(--color-border-secondary)] px-3 py-2 text-[10px] text-[var(--color-text-tertiary)]">
                {workrooms.length} workroom{workrooms.length !== 1 ? 's' : ''}
                {slackConnected && slackChannels.length > 0 && ` · ${slackChannels.length} Slack`}
              </div>
            )}
          </aside>

          {/* ── Main view ── */}
          {activeSlackChannel && slackAuth?.accessToken ? (
            <SlackChannelView channel={activeSlackChannel} token={slackAuth.accessToken} />
          ) : dedupedRoom ? (
            <RoomView
              room={dedupedRoom}
              agents={agents}
              thinkingBudget={thinkingBudget}
              onAppendMessage={(msg) => appendMessage(dedupedRoom.id, msg)}
              onUpdateMessage={(msgId, patch) => updateMessage(dedupedRoom.id, msgId, patch)}
              onUpdateDispatch={(dispatch) => updateDispatch(dedupedRoom.id, dispatch)}
              onAddParticipant={(p) => addParticipant(dedupedRoom.id, p)}
            />
          ) : (
            <EmptyState />
          )}
        </div>
      )}
    </div>
  )
}
