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
    <button
      onClick={onClick}
      style={{
        display: 'flex',
        width: '100%',
        alignItems: 'center',
        gap: '8px',
        borderRadius: '8px',
        padding: '7px 8px',
        textAlign: 'left' as const,
        cursor: 'pointer',
        background: active ? 'var(--accent-soft)' : 'transparent',
        border: 'none',
        fontFamily: 'inherit',
      }}
    >
      {/* Room avatar */}
      <div
        style={{
          width: '28px',
          height: '28px',
          borderRadius: '8px',
          background: avatarColorRaw(room.name),
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '12px',
          fontWeight: 700,
          color: '#fff',
        }}
      >
        {room.name.charAt(0).toUpperCase()}
      </div>
      {/* Text column */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: '12.5px',
          fontWeight: 600,
          color: 'var(--ink)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}>
          {room.name}
        </div>
        <div style={{
          fontSize: '10.5px',
          color: 'var(--ink3)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}>
          {last ? `${last.participantName}: ${last.content.slice(0, 45)}` : room.description || 'No messages yet'}
        </div>
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
          <span className="font-semibold text-[var(--accent)]">&rarr; Dispatched to {msg.participantName}</span>
          <p className="mt-0.5 text-[var(--color-text-secondary)]">{msg.content}</p>
        </div>
      </div>
    )
  }

  const isUser = msg.participantId === 'user'
  const agentMatch = agents.find((a) => a.name === msg.participantName)

  return (
    <div style={{ display: 'flex', alignItems: 'start', gap: '8px' }}>
      {/* Avatar */}
      <div
        style={{
          width: '26px',
          height: '26px',
          borderRadius: '13px',
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '10px',
          fontWeight: 700,
          color: '#fff',
          background: msg.participantKind === 'agent'
            ? (agentMatch?.color?.startsWith('bg-[') ? agentMatch.color.slice(4, -1) : '#64748b')
            : msg.participantKind === 'system'
            ? '#0f172a'
            : avatarColorRaw(msg.participantName),
        }}
      >
        {msg.participantKind === 'system' ? 'N' : initials(msg.participantName)}
      </div>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '3px' }}>
          <span style={{ fontSize: '12px', fontWeight: 700, color: isUser ? 'var(--accent)' : 'var(--ink2)' }}>
            {msg.participantName}
          </span>
          <span style={{ fontSize: '10.5px', color: 'var(--ink3)' }}>{formatTime(msg.createdAt)}</span>
        </div>
        <div style={{
          borderRadius: '14px',
          padding: '8px 14px',
          fontSize: '13.5px',
          lineHeight: '1.6',
          whiteSpace: 'pre-wrap' as const,
          background: isUser
            ? 'var(--accent-soft)'
            : msg.participantKind === 'agent'
            ? 'var(--paper)'
            : 'var(--paper-sunk-2)',
          color: 'var(--ink)',
          border: msg.participantKind === 'agent' ? '1px solid var(--line-soft)' : 'none',
        }}>
          {msg.content}
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
    <div style={{
      width: '250px',
      flexShrink: 0,
      borderLeft: '1px solid var(--line)',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    }}>
      {/* Header + agent list */}
      <div style={{ padding: '12px 14px 10px', borderBottom: '1px solid var(--line-soft)' }}>
        <div style={{
          fontSize: '11px',
          fontWeight: 700,
          letterSpacing: '0.6px',
          textTransform: 'uppercase' as const,
          color: 'var(--ink2)',
          marginBottom: '10px',
        }}>
          Dispatch agents
        </div>
        {agents.map((arch) => {
          const isSelected = selectedAgents.has(arch.id)
          const dotColor = arch.color.startsWith('bg-[') ? arch.color.slice(4, -1) : arch.color
          return (
            <button
              key={arch.id}
              onClick={() => toggleAgent(arch.id)}
              style={{
                display: 'flex',
                width: '100%',
                alignItems: 'center',
                gap: '8px',
                borderRadius: '8px',
                padding: '6px 8px',
                textAlign: 'left' as const,
                cursor: 'pointer',
                background: isSelected ? 'var(--accent-soft)' : 'transparent',
                border: 'none',
                fontFamily: 'inherit',
                marginBottom: '2px',
              }}
            >
              {/* Colored dot */}
              <div style={{
                width: '8px',
                height: '8px',
                borderRadius: '4px',
                flexShrink: 0,
                background: dotColor,
              }} />
              {/* Name + description */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--ink)' }}>{arch.name}</div>
                <div style={{
                  fontSize: '10.5px',
                  color: 'var(--ink3)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}>
                  {arch.description}
                </div>
              </div>
              {/* Checkbox */}
              <div style={{
                width: '14px',
                height: '14px',
                borderRadius: '4px',
                border: `1.5px solid ${isSelected ? 'var(--accent)' : 'var(--ink3)'}`,
                background: isSelected ? 'var(--accent)' : 'transparent',
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '9px',
                color: '#fff',
              }}>
                {isSelected ? '✓' : ''}
              </div>
            </button>
          )
        })}
      </div>

      {/* Dispatch form */}
      <div style={{ padding: '12px 14px', flex: 1, display: 'flex', flexDirection: 'column', gap: '8px', overflowY: 'auto' }}>
        <textarea
          value={task}
          onChange={(e) => setTask(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleDispatch() }}
          placeholder="Describe the task for selected agents…"
          rows={4}
          style={{
            border: '1px solid var(--line-soft)',
            borderRadius: '9px',
            padding: '8px 10px',
            fontSize: '12.5px',
            color: 'var(--ink)',
            background: 'var(--paper-sunk)',
            outline: 'none',
            resize: 'none',
            fontFamily: 'inherit',
            lineHeight: '1.5',
            width: '100%',
            boxSizing: 'border-box',
          }}
        />
        <button
          onClick={handleDispatch}
          disabled={!canDispatch}
          style={{
            padding: '8px',
            borderRadius: '9px',
            background: canDispatch ? 'var(--accent)' : 'var(--paper-sunk)',
            color: canDispatch ? '#fff' : 'var(--ink3)',
            fontSize: '13px',
            fontWeight: 700,
            cursor: canDispatch ? 'pointer' : 'not-allowed',
            textAlign: 'center',
            opacity: canDispatch ? 1 : 0.5,
            border: 'none',
            fontFamily: 'inherit',
          }}
        >
          {dispatchLabel}
        </button>
        <div style={{ fontSize: '10.5px', color: 'var(--ink3)', lineHeight: '1.5' }}>
          Selected agents each get a parallel, independent request &mdash; they see the last 20 room messages as context.
        </div>
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

    const alreadyIn = room.participants.some((p) => p.agentId === agentId)
    if (!alreadyIn) {
      onAddParticipant({ id: agentId, name: arch.name, kind: 'agent', agentId, joinedAt: new Date().toISOString() })
    }

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
    <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minWidth: 0 }}>
      {/* Chat column */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
        {/* Room header */}
        <div style={{
          padding: '12px 18px',
          borderBottom: '1px solid var(--line-soft)',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          flexShrink: 0,
        }}>
          <div
            style={{
              width: '30px',
              height: '30px',
              borderRadius: '9px',
              background: avatarColorRaw(room.name),
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '13px',
              fontWeight: 700,
              color: '#fff',
            }}
          >
            {room.name.charAt(0).toUpperCase()}
          </div>
          <div>
            <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--ink)' }}>{room.name}</div>
            {room.description && (
              <div style={{ fontSize: '11px', color: 'var(--ink3)' }}>{room.description}</div>
            )}
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: '6px', alignItems: 'center' }}>
            <div style={{
              padding: '4px 10px',
              borderRadius: '7px',
              border: '1px solid var(--line-soft)',
              fontSize: '11.5px',
              color: 'var(--ink3)',
            }}>
              {room.participants.length} participant{room.participants.length !== 1 ? 's' : ''}
            </div>
          </div>
        </div>

        {/* Transcript */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {room.messages.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '48px 20px', color: 'var(--ink3)', fontSize: '13px' }}>
              <div style={{ fontSize: '22px', marginBottom: '10px' }}>&#x1F4AC;</div>
              <div style={{ fontWeight: 600, color: 'var(--ink2)', marginBottom: '4px' }}>Room is open</div>
              <div>Chat freely, or dispatch agents from the panel &rarr;</div>
            </div>
          ) : (
            room.messages.map((msg) => <MessageRow key={msg.id} msg={msg} agents={agents} />)
          )}
          <div ref={bottomRef} />
        </div>

        {/* Message input */}
        <div style={{
          padding: '12px 16px',
          borderTop: '1px solid var(--line-soft)',
          flexShrink: 0,
          display: 'flex',
          alignItems: 'flex-end',
          gap: '8px',
        }}>
          <textarea
            value={input}
            disabled={sending}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void sendChat() }}
            placeholder="Write something to the room… (agents don't reply unless dispatched)"
            rows={2}
            style={{
              flex: 1,
              border: '1px solid var(--line-soft)',
              borderRadius: '10px',
              padding: '8px 12px',
              fontSize: '13px',
              color: 'var(--ink)',
              background: 'var(--paper)',
              outline: 'none',
              resize: 'none',
              fontFamily: 'inherit',
              lineHeight: '1.5',
            }}
          />
          <button
            onClick={() => void sendChat()}
            disabled={!input.trim() || sending}
            style={{
              padding: '8px 14px',
              borderRadius: '10px',
              background: 'var(--accent)',
              color: '#fff',
              fontSize: '13px',
              fontWeight: 700,
              cursor: (!input.trim() || sending) ? 'not-allowed' : 'pointer',
              flexShrink: 0,
              marginBottom: '1px',
              border: 'none',
              fontFamily: 'inherit',
              opacity: (!input.trim() || sending) ? 0.5 : 1,
            }}
          >
            {sending ? '...' : 'Send'}
          </button>
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
        <div className="ml-auto text-[10px] text-[var(--color-text-tertiary)]">Read-only &mdash; post from Slack</div>
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
        Showing last 30 messages &middot; Connected via Slack OAuth &middot; Post replies from Slack
      </div>
    </div>
  )
}

// ─── New workroom form (inline in sidebar) ──────────────────────────────────

function NewRoomForm({ onCreate, onCancel }: { onCreate: (name: string, desc: string) => void; onCancel: () => void }) {
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  return (
    <div style={{
      padding: '10px 12px',
      borderBottom: '1px solid var(--line-soft)',
      background: 'var(--paper)',
      display: 'flex',
      flexDirection: 'column',
      gap: '6px',
    }}>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) onCreate(name, desc) }}
        placeholder="Room name"
        autoFocus
        style={{
          border: '1px solid var(--line-soft)',
          borderRadius: '7px',
          padding: '6px 9px',
          fontSize: '12.5px',
          color: 'var(--ink)',
          background: 'var(--paper-sunk)',
          outline: 'none',
          fontFamily: 'inherit',
          width: '100%',
          boxSizing: 'border-box',
        }}
      />
      <input
        value={desc}
        onChange={(e) => setDesc(e.target.value)}
        placeholder="Description (optional)"
        style={{
          border: '1px solid var(--line-soft)',
          borderRadius: '7px',
          padding: '6px 9px',
          fontSize: '12px',
          color: 'var(--ink)',
          background: 'var(--paper-sunk)',
          outline: 'none',
          fontFamily: 'inherit',
          width: '100%',
          boxSizing: 'border-box',
        }}
      />
      <div style={{ display: 'flex', gap: '6px' }}>
        <button
          onClick={() => { if (name.trim()) onCreate(name, desc) }}
          disabled={!name.trim()}
          style={{
            flex: 1,
            padding: '6px',
            borderRadius: '7px',
            background: 'var(--accent)',
            color: '#fff',
            fontSize: '12px',
            fontWeight: 700,
            cursor: name.trim() ? 'pointer' : 'not-allowed',
            textAlign: 'center',
            border: 'none',
            fontFamily: 'inherit',
            opacity: name.trim() ? 1 : 0.5,
          }}
        >
          Create
        </button>
        <button
          onClick={onCancel}
          style={{
            padding: '6px 8px',
            borderRadius: '7px',
            border: '1px solid var(--line)',
            color: 'var(--ink2)',
            fontSize: '12px',
            fontWeight: 600,
            cursor: 'pointer',
            background: 'transparent',
            fontFamily: 'inherit',
          }}
        >
          Cancel
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
    <div style={{
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '20px',
      padding: '40px',
    }}>
      {/* Icon */}
      <div style={{
        width: '56px',
        height: '56px',
        borderRadius: '16px',
        background: 'var(--paper-sunk)',
        border: '1.5px solid var(--line)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '26px',
      }}>
        &#x1F3A5;
      </div>

      {/* Text */}
      <div style={{ textAlign: 'center', maxWidth: '360px' }}>
        <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--ink)', marginBottom: '8px' }}>Video call</div>
        <div style={{ fontSize: '13px', color: 'var(--ink2)', lineHeight: '1.6', marginBottom: '20px' }}>
          Powered by Jitsi Meet. Not linked to a specific room &mdash; type any room name to start or join a call.
        </div>
      </div>

      {/* Input row */}
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', width: '100%', maxWidth: '380px' }}>
        <input
          value={roomName}
          onChange={(e) => setRoomName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') joinCall() }}
          placeholder="Room name e.g. noetica-planning"
          style={{
            flex: 1,
            border: '1px solid var(--line-soft)',
            borderRadius: '10px',
            padding: '9px 12px',
            fontSize: '13.5px',
            color: 'var(--ink)',
            background: 'var(--paper)',
            outline: 'none',
            fontFamily: 'inherit',
          }}
        />
        <button
          onClick={generateRandom}
          style={{
            padding: '9px 12px',
            borderRadius: '10px',
            border: '1px solid var(--line-soft)',
            color: 'var(--ink2)',
            fontSize: '12.5px',
            fontWeight: 600,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
            background: 'transparent',
            fontFamily: 'inherit',
          }}
        >
          Random
        </button>
      </div>

      {/* Join button */}
      <button
        onClick={joinCall}
        disabled={!roomName.trim()}
        style={{
          padding: '10px 28px',
          borderRadius: '11px',
          background: 'var(--accent)',
          color: '#fff',
          fontSize: '14px',
          fontWeight: 700,
          cursor: roomName.trim() ? 'pointer' : 'not-allowed',
          opacity: roomName.trim() ? 1 : 0.4,
          border: 'none',
          fontFamily: 'inherit',
        }}
      >
        Join call
      </button>

      {/* Footer */}
      <div style={{ fontSize: '11px', color: 'var(--ink3)' }}>Opens in a new tab via meet.jit.si</div>
    </div>
  )
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div style={{
      flex: 1,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: 'var(--ink3)',
      fontSize: '13px',
      flexDirection: 'column',
      gap: '10px',
    }}>
      <div style={{ fontSize: '22px' }}>&#x1F3E0;</div>
      <div>Select or create a room to get started</div>
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

  const [customAgents, setCustomAgents] = useState<CustomAgentSummary[]>([])
  useEffect(() => {
    void fetch(amUrl('/api/agents'))
      .then((r) => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then((d: { custom?: CustomAgentSummary[] }) => setCustomAgents(d.custom ?? []))
      .catch(() => {})
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
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
      {/* Tab bar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        borderBottom: '1px solid var(--line)',
        flexShrink: 0,
        padding: '0 20px',
        gap: 0,
      }}>
        <button
          onClick={() => setActiveTab('workrooms')}
          style={{
            padding: '10px 16px 9px',
            fontSize: '13px',
            fontWeight: activeTab === 'workrooms' ? 700 : 400,
            color: activeTab === 'workrooms' ? 'var(--accent)' : 'var(--ink3)',
            borderBottom: `2px solid ${activeTab === 'workrooms' ? 'var(--accent)' : 'transparent'}`,
            cursor: 'pointer',
            marginBottom: '-1px',
            background: 'none',
            border: 'none',
            borderBottomStyle: 'solid',
            borderBottomWidth: '2px',
            borderBottomColor: activeTab === 'workrooms' ? 'var(--accent)' : 'transparent',
            fontFamily: 'inherit',
          }}
        >
          Workrooms
        </button>
        <button
          onClick={() => setActiveTab('video')}
          style={{
            padding: '10px 16px 9px',
            fontSize: '13px',
            fontWeight: activeTab === 'video' ? 700 : 400,
            color: activeTab === 'video' ? 'var(--accent)' : 'var(--ink3)',
            cursor: 'pointer',
            marginBottom: '-1px',
            background: 'none',
            border: 'none',
            borderBottomStyle: 'solid',
            borderBottomWidth: '2px',
            borderBottomColor: activeTab === 'video' ? 'var(--accent)' : 'transparent',
            fontFamily: 'inherit',
          }}
        >
          Video
        </button>
      </div>

      {/* Tab content */}
      {activeTab === 'video' ? (
        <VideoTabContent />
      ) : (
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>
          {/* Room list sidebar */}
          <div style={{
            width: '210px',
            flexShrink: 0,
            borderRight: '1px solid var(--line)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            background: 'var(--paper-sunk)',
          }}>
            {/* Sidebar header */}
            <div style={{
              padding: '12px 12px 8px',
              borderBottom: '1px solid var(--line-soft)',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}>
              <span style={{
                fontSize: '11px',
                fontWeight: 700,
                letterSpacing: '0.6px',
                textTransform: 'uppercase' as const,
                color: 'var(--ink2)',
                flex: 1,
              }}>
                Rooms
              </span>
              <button
                onClick={() => setShowNew(true)}
                title="New workroom"
                style={{
                  width: '22px',
                  height: '22px',
                  borderRadius: '6px',
                  background: 'var(--accent)',
                  color: '#fff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '15px',
                  cursor: 'pointer',
                  lineHeight: 1,
                  border: 'none',
                  fontFamily: 'inherit',
                  padding: 0,
                }}
              >
                +
              </button>
            </div>

            {/* Create room form */}
            {hydrated && showNew && (
              <NewRoomForm onCreate={handleCreate} onCancel={() => setShowNew(false)} />
            )}

            {/* Room list */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '6px 8px' }}>
              {!hydrated && <p style={{ padding: '16px 0', textAlign: 'center', fontSize: '12px', color: 'var(--ink3)' }}>Loading...</p>}
              {hydrated && filtered.length === 0 && !showNew && (
                <div style={{ textAlign: 'center', padding: '28px 12px', color: 'var(--ink3)', fontSize: '12px' }}>
                  Create your first room
                </div>
              )}
              {filtered.map((room) => (
                <RoomListItem key={room.id} room={room}
                  active={active?.kind === 'workroom' && active.id === room.id}
                  onClick={() => setActive({ kind: 'workroom', id: room.id })} />
              ))}
            </div>

            {/* Slack section */}
            {slackConnected ? (
              <div style={{ borderTop: '1px solid var(--line)', padding: '8px 8px 6px' }}>
                <button
                  onClick={() => setSlackExpanded((v) => !v)}
                  style={{
                    display: 'flex',
                    width: '100%',
                    alignItems: 'center',
                    gap: '4px',
                    padding: '0 4px 6px',
                    fontSize: '9.5px',
                    fontWeight: 700,
                    letterSpacing: '0.7px',
                    textTransform: 'uppercase' as const,
                    color: 'var(--ink3)',
                    cursor: 'pointer',
                    background: 'none',
                    border: 'none',
                    fontFamily: 'inherit',
                  }}
                >
                  Slack (read-only)
                  {slackAuth?.userInfo?.name && (
                    <span style={{ marginLeft: 'auto', fontWeight: 400, textTransform: 'none', letterSpacing: 'normal', color: 'var(--ink3)', fontSize: '9.5px' }}>
                      {slackAuth.userInfo.name}
                    </span>
                  )}
                </button>
                {slackExpanded && (
                  <>
                    {slackLoading ? (
                      <div style={{ padding: '8px 8px', fontSize: '10.5px', color: 'var(--ink3)' }}>Loading channels...</div>
                    ) : slackChannels.length === 0 ? (
                      <div style={{ padding: '4px 8px', fontSize: '10.5px', color: 'var(--ink3)' }}>No channels found.</div>
                    ) : (
                      slackChannels.map((ch) => {
                        const isActive = active?.kind === 'slack' && active.channel.id === ch.id
                        return (
                          <button
                            key={ch.id}
                            onClick={() => setActive({ kind: 'slack', channel: ch })}
                            style={{
                              display: 'flex',
                              width: '100%',
                              alignItems: 'center',
                              gap: '7px',
                              padding: '5px 8px',
                              borderRadius: '7px',
                              cursor: 'pointer',
                              background: isActive ? 'var(--accent-soft)' : 'transparent',
                              border: 'none',
                              fontFamily: 'inherit',
                            }}
                          >
                            <div style={{ width: '7px', height: '7px', borderRadius: '2px', background: 'var(--ink3)' }} />
                            <span style={{ fontSize: '12px', color: isActive ? 'var(--accent)' : 'var(--ink2)' }}>
                              {ch.isPrivate ? '🔒' : '#'}{ch.name}
                            </span>
                            {(ch.unreadCount ?? 0) > 0 && (
                              <span style={{
                                marginLeft: 'auto',
                                borderRadius: '9999px',
                                background: '#7c3aed',
                                padding: '1px 6px',
                                fontSize: '9px',
                                fontWeight: 700,
                                color: '#fff',
                              }}>
                                {ch.unreadCount}
                              </span>
                            )}
                          </button>
                        )
                      })
                    )}
                  </>
                )}
              </div>
            ) : (
              <div style={{ borderTop: '1px solid var(--line)', padding: '8px 8px 6px' }}>
                <div style={{
                  fontSize: '9.5px',
                  fontWeight: 700,
                  letterSpacing: '0.7px',
                  textTransform: 'uppercase' as const,
                  color: 'var(--ink3)',
                  padding: '0 4px 6px',
                }}>
                  Slack (read-only)
                </div>
                <div style={{ padding: '5px 8px', borderRadius: '7px', display: 'flex', alignItems: 'center', gap: '7px', cursor: 'default', opacity: 0.5 }}>
                  <div style={{ width: '7px', height: '7px', borderRadius: '2px', background: 'var(--ink3)' }} />
                  <span style={{ fontSize: '12px', color: 'var(--ink2)' }}>#product-planning</span>
                </div>
                <div style={{ padding: '5px 8px', borderRadius: '7px', display: 'flex', alignItems: 'center', gap: '7px', cursor: 'default', opacity: 0.5 }}>
                  <div style={{ width: '7px', height: '7px', borderRadius: '2px', background: 'var(--ink3)' }} />
                  <span style={{ fontSize: '12px', color: 'var(--ink2)' }}>#engineering</span>
                </div>
                <div style={{ padding: '4px 8px', fontSize: '10.5px', color: 'var(--ink3)', marginTop: '2px' }}>
                  Connect Slack in Settings &rarr;
                </div>
              </div>
            )}
          </div>

          {/* Main view */}
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
