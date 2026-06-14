'use client'

import { useEffect, useRef, useState } from 'react'
import { useWorkrooms } from '@/lib/workrooms/useWorkrooms'
import { useSettings } from '@/lib/settings/context'
import { sendNoeticaChat } from '@/lib/client/noeticaTransport'
import type { Workroom, WorkroomMessage, AgentDispatch } from '@/lib/types/workroom'
import { AGENT_ARCHETYPES } from '@/lib/types/workroom'
import type { ChatMessage } from '@/lib/types/message'

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
  'bg-[#1d4ed8]', 'bg-[#7c3aed]', 'bg-[#0891b2]',
  'bg-[#059669]', 'bg-[#d97706]', 'bg-[#dc2626]',
]
function avatarColor(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) & 0xffff
  return AVATAR_COLORS[hash % AVATAR_COLORS.length]
}
function initials(name: string): string {
  return name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()
}

// ─── Room list ────────────────────────────────────────────────────────────────

function RoomListItem({ room, active, onClick }: { room: Workroom; active: boolean; onClick: () => void }) {
  const last = room.messages[room.messages.length - 1]
  return (
    <button onClick={onClick}
      className={`flex w-full flex-col gap-0.5 rounded-xl px-3 py-2.5 text-left transition ${active ? 'bg-[#dbeafe]' : 'hover:bg-[var(--color-background-tertiary)]'}`}>
      <div className="flex items-center gap-1.5">
        {room.pinned && <span className="text-[10px] text-[#f59e0b]">★</span>}
        <span className={`truncate text-sm font-medium ${active ? 'text-[#1d4ed8]' : 'text-[var(--color-text-primary)]'}`}>
          {room.name}
        </span>
        <span className="ml-auto shrink-0 text-[10px] text-[#cbd5e1]">{timeAgo(room.updatedAt)}</span>
      </div>
      <p className="truncate text-xs text-[var(--color-text-tertiary)]">
        {last ? `${last.participantName}: ${last.content.slice(0, 45)}` : room.description || 'No messages yet'}
      </p>
      <div className="flex items-center gap-1 text-[10px] text-[var(--color-text-tertiary)]">
        <span>{room.participants.length} participant{room.participants.length !== 1 ? 's' : ''}</span>
        {room.dispatches.length > 0 && (
          <span>· {room.dispatches.filter((d) => d.status === 'done').length}/{room.dispatches.length} dispatches</span>
        )}
      </div>
    </button>
  )
}

// ─── Chat message row ─────────────────────────────────────────────────────────

function MessageRow({ msg }: { msg: WorkroomMessage }) {
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
        <div className="rounded-xl border border-[#bfdbfe] bg-[#eff6ff] px-4 py-2 text-xs">
          <span className="font-semibold text-[#1d4ed8]">→ Dispatched to {msg.participantName}</span>
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
          ? (AGENT_ARCHETYPES.find((a) => a.name === msg.participantName)?.color ?? 'bg-[#64748b]')
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
            ? 'bg-[#dbeafe] text-[var(--color-text-primary)]'
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

function AgentDispatchPanel({ room, onDispatch }: {
  room: Workroom
  onDispatch: (agentId: string, task: string) => Promise<void>
}) {
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null)
  const [task, setTask] = useState('')
  const [dispatching, setDispatching] = useState(false)

  const activeAgentIds = room.participants.filter((p) => p.kind === 'agent').map((p) => p.agentId)
  const inactiveAgents = AGENT_ARCHETYPES.filter((a) => !activeAgentIds.includes(a.id))

  async function handleDispatch() {
    if (!selectedAgent || !task.trim() || dispatching) return
    setDispatching(true)
    try {
      await onDispatch(selectedAgent, task.trim())
      setTask('')
      setSelectedAgent(null)
    } finally {
      setDispatching(false)
    }
  }

  return (
    <div className="flex w-72 shrink-0 flex-col border-l border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)]">
      {/* Header */}
      <div className="border-b border-[var(--color-border-secondary)] px-4 py-3">
        <p className="text-xs font-semibold text-[var(--color-text-primary)]">Agent Dispatch</p>
        <p className="text-[11px] text-[var(--color-text-tertiary)]">Assign tasks to specialist agents</p>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {/* Active agents */}
        {room.participants.filter((p) => p.kind === 'agent').length > 0 && (
          <div className="space-y-1.5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">In this room</p>
            {room.participants.filter((p) => p.kind === 'agent').map((p) => {
              const arch = AGENT_ARCHETYPES.find((a) => a.id === p.agentId)
              return (
                <button key={p.id} onClick={() => setSelectedAgent(p.agentId ?? null)}
                  className={`flex w-full items-center gap-2.5 rounded-xl border px-3 py-2 text-left transition ${
                    selectedAgent === p.agentId ? 'border-[#1d4ed8] bg-[#eff6ff]' : 'border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] hover:border-[#bfdbfe]'
                  }`}>
                  <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white ${arch?.color ?? 'bg-[#64748b]'}`}>
                    {initials(p.name)}
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-[var(--color-text-primary)]">{p.name}</p>
                    {arch && <p className="text-[11px] text-[var(--color-text-secondary)]">{arch.description}</p>}
                  </div>
                  {selectedAgent === p.agentId && (
                    <svg className="ml-auto shrink-0" width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
                      <path d="M2 6l3 3 5-5" stroke="#1d4ed8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  )}
                </button>
              )
            })}
          </div>
        )}

        {/* Available agents to add */}
        {inactiveAgents.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">Available agents</p>
            {AGENT_ARCHETYPES.map((arch) => {
              const isActive = activeAgentIds.includes(arch.id)
              return (
                <div key={arch.id}
                  className={`flex items-center gap-2.5 rounded-xl border px-3 py-2 ${isActive ? 'border-[#dcfce7] bg-[#f0fdf4]' : 'border-[var(--color-border-secondary)] bg-[var(--color-background-primary)]'}`}>
                  <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white ${arch.color}`}>
                    {initials(arch.name)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-[var(--color-text-primary)]">{arch.name}</p>
                    <div className="mt-0.5 flex flex-wrap gap-1">
                      {arch.tags.map((t) => (
                        <span key={t} className="rounded-full bg-[var(--color-background-tertiary)] px-1.5 text-[10px] text-[var(--color-text-secondary)]">{t}</span>
                      ))}
                    </div>
                  </div>
                  {isActive ? (
                    <span className="shrink-0 text-[10px] font-semibold text-[#22c55e]">Active</span>
                  ) : (
                    <button onClick={() => setSelectedAgent(arch.id)}
                      className="shrink-0 rounded-lg border border-[#bfdbfe] bg-[#eff6ff] px-2 py-1 text-[10px] font-semibold text-[#1d4ed8] transition hover:bg-[#dbeafe]">
                      Use
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* Dispatch history */}
        {room.dispatches.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">Recent dispatches</p>
            {[...room.dispatches].reverse().slice(0, 5).map((d) => (
              <div key={d.id} className="rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-3 py-2 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-[var(--color-text-primary)]">{d.agentName}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                    d.status === 'done'    ? 'bg-[#dcfce7] text-[#166534]' :
                    d.status === 'running' ? 'bg-[#fef9c3] text-[#854d0e] animate-pulse' :
                    'bg-[#fee2e2] text-[#991b1b]'
                  }`}>{d.status}</span>
                </div>
                <p className="mt-0.5 text-[var(--color-text-secondary)] line-clamp-2">{d.task}</p>
                <p className="mt-0.5 text-[10px] text-[#cbd5e1]">{timeAgo(d.dispatchedAt)}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Dispatch form */}
      {selectedAgent && (
        <div className="border-t border-[var(--color-border-secondary)] p-3 space-y-2">
          {(() => {
            const arch = AGENT_ARCHETYPES.find((a) => a.id === selectedAgent)
            return arch ? (
              <div className="flex items-center gap-2">
                <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white ${arch.color}`}>
                  {initials(arch.name)}
                </div>
                <p className="text-xs font-semibold text-[var(--color-text-primary)]">Dispatch to {arch.name}</p>
                <button onClick={() => setSelectedAgent(null)} className="ml-auto text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]">
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
                    <path d="M1 1l8 8M9 1L1 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                  </svg>
                </button>
              </div>
            ) : null
          })()}
          <textarea
            className="w-full resize-none rounded-xl border border-[#bfdbfe] bg-[var(--color-background-primary)] px-3 py-2 text-xs leading-5 text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-tertiary)] focus:border-[#1d4ed8]"
            placeholder="Describe the task…"
            rows={3}
            value={task}
            disabled={dispatching}
            onChange={(e) => setTask(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void handleDispatch() }}
          />
          <button onClick={() => void handleDispatch()}
            disabled={!task.trim() || dispatching}
            className="w-full rounded-xl bg-[#1d4ed8] py-2 text-xs font-semibold text-white transition hover:bg-[#1e40af] disabled:cursor-not-allowed disabled:opacity-50">
            {dispatching ? 'Dispatching…' : 'Dispatch'}
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Room view ────────────────────────────────────────────────────────────────

const YOU: WorkroomMessage['participantId'] = 'user'

function RoomView({ room, onAppendMessage, onUpdateDispatch }: {
  room: Workroom
  onAppendMessage: (msg: WorkroomMessage) => void
  onUpdateDispatch: (dispatch: AgentDispatch) => void
}) {
  const { settings } = useSettings()
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

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
    const arch = AGENT_ARCHETYPES.find((a) => a.id === agentId)
    if (!arch) return

    // Ensure agent is in participants
    const alreadyIn = room.participants.some((p) => p.agentId === agentId)
    if (!alreadyIn) {
      // We can't mutate participants here (workroom hook needed) so just proceed
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

    // Stream response
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
          agent_machine_endpoint:
            settings.runtimeMode === 'agent-machine' ? settings.agentMachineEndpoint : undefined,
        },
        {
          onMeta: () => {},
          onDelta: (delta) => {
            fullContent += delta
            // Update the result message content in place
            onAppendMessage({ ...resultMsg, content: fullContent })
          },
          onDone: (result) => {
            onUpdateDispatch({ ...dispatch, status: 'done', completedAt: new Date().toISOString(), messageId: resultMsgId })
            onAppendMessage({ ...resultMsg, content: result.content })
          },
          onError: (err) => {
            onUpdateDispatch({ ...dispatch, status: 'error', completedAt: new Date().toISOString() })
            onAppendMessage({ ...resultMsg, content: `Error: ${err}` })
          },
        }
      )
    } catch (e) {
      onUpdateDispatch({ ...dispatch, status: 'error', completedAt: new Date().toISOString() })
    }
  }

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      {/* Chat column */}
      <div className="flex min-h-0 flex-1 flex-col">
        {/* Room header */}
        <div className="flex items-center gap-3 border-b border-[var(--color-border-secondary)] px-6 py-3">
          <div>
            <p className="text-sm font-semibold text-[var(--color-text-primary)]">{room.name}</p>
            <p className="text-xs text-[var(--color-text-tertiary)]">
              {room.participants.length} participant{room.participants.length !== 1 ? 's' : ''}
              {room.description ? ` · ${room.description}` : ''}
            </p>
          </div>
          {/* Participant avatars */}
          <div className="ml-auto flex -space-x-1.5">
            {room.participants.slice(0, 5).map((p) => {
              const arch = p.kind === 'agent' ? AGENT_ARCHETYPES.find((a) => a.id === p.agentId) : null
              return (
                <div key={p.id} title={p.name}
                  className={`flex h-7 w-7 items-center justify-center rounded-full border-2 border-white text-[10px] font-bold text-white ${arch?.color ?? avatarColor(p.name)}`}>
                  {initials(p.name)}
                </div>
              )
            })}
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
          {room.messages.map((msg) => <MessageRow key={msg.id} msg={msg} />)}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="border-t border-[var(--color-border-secondary)] px-6 py-4">
          <div className="flex items-end gap-3 rounded-2xl border border-[#bfdbfe] bg-[var(--color-background-primary)] px-4 py-3 shadow-sm">
            <textarea
              className="min-h-[2.5rem] flex-1 resize-none bg-transparent text-sm leading-6 text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-tertiary)]"
              placeholder="Send a message to the workroom… (⌘ + Enter)"
              value={input}
              disabled={sending}
              onChange={(e) => setInput(e.target.value)}
              rows={1}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void sendChat() }}
            />
            <button onClick={() => void sendChat()}
              disabled={!input.trim() || sending}
              className="shrink-0 rounded-xl bg-[#1d4ed8] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#1e40af] disabled:cursor-not-allowed disabled:opacity-50">
              {sending ? '…' : 'Send'}
            </button>
          </div>
        </div>
      </div>

      {/* Agent dispatch column */}
      <AgentDispatchPanel room={room} onDispatch={dispatchToAgent} />
    </div>
  )
}

// ─── New workroom form ────────────────────────────────────────────────────────

function NewRoomForm({ onCreate, onCancel }: { onCreate: (name: string, desc: string) => void; onCancel: () => void }) {
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  return (
    <div className="rounded-xl border border-[#bfdbfe] bg-[#eff6ff] p-4 space-y-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-[#1d4ed8]">New Workroom</p>
      <div className="space-y-1">
        <label className="text-xs font-medium text-[var(--color-text-secondary)]">Name</label>
        <input className="w-full rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-3 py-1.5 text-sm outline-none focus:border-[#93c5fd]"
          placeholder="Team planning room" value={name} onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) onCreate(name, desc) }}
          autoFocus />
      </div>
      <div className="space-y-1">
        <label className="text-xs font-medium text-[var(--color-text-secondary)]">Description <span className="font-normal text-[var(--color-text-tertiary)]">(optional)</span></label>
        <input className="w-full rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-3 py-1.5 text-sm outline-none focus:border-[#93c5fd]"
          placeholder="What's this room for?" value={desc} onChange={(e) => setDesc(e.target.value)} />
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <button onClick={onCancel} className="rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-4 py-1.5 text-xs font-medium text-[var(--color-text-secondary)] transition hover:bg-[var(--color-background-tertiary)]">Cancel</button>
        <button onClick={() => { if (name.trim()) onCreate(name, desc) }}
          disabled={!name.trim()}
          className="rounded-lg bg-[#1d4ed8] px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-[#1e40af] disabled:opacity-50">
          Create
        </button>
      </div>
    </div>
  )
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
      <div className="rounded-2xl border border-dashed border-[#bfdbfe] bg-[#eff6ff] p-10 max-w-sm">
        <p className="text-sm font-semibold text-[var(--color-text-secondary)]">No workroom selected</p>
        <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
          Workrooms are persistent collaboration spaces where you and specialist agents work together on tasks.
        </p>
        <button onClick={onCreate}
          className="mt-4 rounded-xl bg-[#1d4ed8] px-5 py-2 text-sm font-semibold text-white transition hover:bg-[#1e40af]">
          New workroom
        </button>
      </div>
    </div>
  )
}

// ─── Main surface ─────────────────────────────────────────────────────────────

export function WorkroomsSurface() {
  const { hydrated, workrooms, createWorkroom, deleteWorkroom, appendMessage, updateDispatch } = useWorkrooms()
  const [activeId, setActiveId] = useState<string | null>(null)
  const [showNew, setShowNew] = useState(false)
  const [search, setSearch] = useState('')

  const activeRoom = workrooms.find((r) => r.id === activeId) ?? null

  const filtered = search.trim()
    ? workrooms.filter((r) =>
        r.name.toLowerCase().includes(search.toLowerCase()) ||
        r.description.toLowerCase().includes(search.toLowerCase())
      )
    : workrooms

  function handleCreate(name: string, desc: string) {
    const room = createWorkroom(name, desc)
    setActiveId(room.id)
    setShowNew(false)
  }

  // Deduplicate streaming result messages — keep only the latest version of each message id
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
    <div className="flex min-h-0 flex-1 overflow-hidden">
      {/* ── Room list ── */}
      <aside className="flex w-56 shrink-0 flex-col border-r border-[var(--color-border-secondary)] bg-[#eaf1f8]">
        <div className="flex items-center justify-between border-b border-[var(--color-border-secondary)] px-3 py-3">
          <span className="text-xs font-semibold uppercase tracking-wide text-[#1d4ed8]">Workrooms</span>
          <button onClick={() => setShowNew(true)} title="New workroom"
            className="flex h-6 w-6 items-center justify-center rounded-lg text-[var(--color-text-secondary)] transition hover:bg-[var(--color-background-primary)] hover:text-[#1d4ed8]">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
              <path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        <div className="px-3 py-2">
          <input className="w-full rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] px-2.5 py-1.5 text-xs outline-none placeholder:text-[var(--color-text-tertiary)] focus:border-[#93c5fd]"
            placeholder="Search rooms…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>

        <div className="flex-1 overflow-y-auto px-2 py-1 space-y-0.5">
          {!hydrated && <p className="py-4 text-center text-xs text-[var(--color-text-tertiary)]">Loading…</p>}
          {hydrated && showNew && (
            <div className="p-2">
              <NewRoomForm onCreate={handleCreate} onCancel={() => setShowNew(false)} />
            </div>
          )}
          {hydrated && filtered.length === 0 && !showNew && (
            <p className="px-2 py-4 text-center text-xs text-[var(--color-text-tertiary)]">{search ? 'No matches' : 'No workrooms yet'}</p>
          )}
          {filtered.map((room) => (
            <RoomListItem key={room.id} room={room} active={activeId === room.id} onClick={() => setActiveId(room.id)} />
          ))}
        </div>

        {hydrated && workrooms.length > 0 && (
          <div className="border-t border-[var(--color-border-secondary)] px-3 py-2 text-[10px] text-[var(--color-text-tertiary)]">
            {workrooms.length} room{workrooms.length !== 1 ? 's' : ''}
          </div>
        )}
      </aside>

      {/* ── Room or empty state ── */}
      {dedupedRoom ? (
        <RoomView
          room={dedupedRoom}
          onAppendMessage={(msg) => appendMessage(dedupedRoom.id, msg)}
          onUpdateDispatch={(dispatch) => updateDispatch(dedupedRoom.id, dispatch)}
        />
      ) : (
        <EmptyState onCreate={() => setShowNew(true)} />
      )}
    </div>
  )
}
