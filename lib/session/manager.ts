import type { ChatMessage } from '@/lib/types/message'
import type { ActiveSurface } from '@/lib/types/surface'
import type { WorkspaceMode } from '@/components/chat/InputArea'
import type { SessionStore, WorkspaceSession, SessionId } from './types'
import { SESSION_STORE_VERSION, MAX_SESSIONS, MAX_MESSAGES_PER_SESSION } from './types'

function now() { return new Date().toISOString() }

function deriveTitle(messages: ChatMessage[]): string {
  const first = messages.find((m) => m.role === 'user')
  const text = typeof first?.content === 'string' ? first.content : ''
  return text.slice(0, 60) || 'New workspace'
}

export function emptyStore(): SessionStore {
  return { activeSessionId: null, sessions: {}, version: SESSION_STORE_VERSION }
}

export function createSession(
  store: SessionStore,
  opts: { surface: ActiveSurface; workspaceMode: WorkspaceMode; modelId: string; messages?: ChatMessage[]; title?: string; parentId?: SessionId }
): { store: SessionStore; session: WorkspaceSession } {
  const id: SessionId = crypto.randomUUID()
  const messages = (opts.messages ?? []).slice(-MAX_MESSAGES_PER_SESSION)
  const session: WorkspaceSession = {
    id, title: opts.title ?? deriveTitle(messages),
    surface: opts.surface, workspaceMode: opts.workspaceMode,
    messages, modelId: opts.modelId,
    createdAt: now(), updatedAt: now(),
    ...(opts.parentId ? { parentId: opts.parentId } : {}),
  }
  let sessions = { ...store.sessions, [id]: session }
  // evict oldest non-pinned if over limit
  const evictable = Object.values(sessions).filter((s) => !s.pinned)
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
  while (evictable.length > MAX_SESSIONS) { const e = evictable.shift()!; delete sessions[e.id] }
  return { store: { ...store, sessions, activeSessionId: id, version: SESSION_STORE_VERSION }, session }
}

export function updateSession(
  store: SessionStore, id: SessionId,
  patch: Partial<Pick<WorkspaceSession, 'messages' | 'surface' | 'workspaceMode' | 'modelId' | 'title' | 'pinned'>>
): SessionStore {
  const existing = store.sessions[id]
  if (!existing) return store
  const messages = patch.messages ? patch.messages.slice(-MAX_MESSAGES_PER_SESSION) : existing.messages
  const updated: WorkspaceSession = {
    ...existing, ...patch, messages,
    title: patch.messages ? deriveTitle(messages) : (patch.title ?? existing.title),
    updatedAt: now(),
  }
  return { ...store, sessions: { ...store.sessions, [id]: updated } }
}

export function deleteSession(store: SessionStore, id: SessionId): SessionStore {
  const sessions = { ...store.sessions }
  delete sessions[id]
  const activeSessionId = store.activeSessionId === id
    ? (Object.values(sessions).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]?.id ?? null)
    : store.activeSessionId
  return { ...store, sessions, activeSessionId }
}

export function setActiveSession(store: SessionStore, id: SessionId): SessionStore {
  if (!store.sessions[id]) return store
  return { ...store, activeSessionId: id }
}

export function sortedSessions(store: SessionStore): WorkspaceSession[] {
  return Object.values(store.sessions).sort((a, b) => {
    if (a.pinned && !b.pinned) return -1
    if (!a.pinned && b.pinned) return 1
    return b.updatedAt.localeCompare(a.updatedAt)
  })
}
