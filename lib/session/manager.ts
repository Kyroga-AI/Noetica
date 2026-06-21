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

// Compute the ephemeral stamp for a session when the security lane is armed.
// Returns {} when ttl is null/0 (lane disarmed → ordinary durable session).
export function ephemeralStamp(ttlMinutes: number | null | undefined, nowMs: number):
  Pick<WorkspaceSession, 'ephemeral' | 'ephemeralExpiresAt'> {
  if (!ttlMinutes || ttlMinutes <= 0) return {}
  return { ephemeral: true, ephemeralExpiresAt: new Date(nowMs + ttlMinutes * 60_000).toISOString() }
}

export function createSession(
  store: SessionStore,
  opts: { surface: ActiveSurface; workspaceMode: WorkspaceMode; modelId: string; messages?: ChatMessage[]; title?: string; parentId?: SessionId; ephemeralTtlMinutes?: number | null }
): { store: SessionStore; session: WorkspaceSession } {
  const id: SessionId = crypto.randomUUID()
  const messages = (opts.messages ?? []).slice(-MAX_MESSAGES_PER_SESSION)
  const session: WorkspaceSession = {
    id, title: opts.title ?? deriveTitle(messages),
    surface: opts.surface, workspaceMode: opts.workspaceMode,
    messages, modelId: opts.modelId,
    createdAt: now(), updatedAt: now(),
    ...(opts.parentId ? { parentId: opts.parentId } : {}),
    ...ephemeralStamp(opts.ephemeralTtlMinutes, Date.now()),
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
  patch: Partial<Pick<WorkspaceSession, 'messages' | 'surface' | 'workspaceMode' | 'modelId' | 'title' | 'pinned' | 'ephemeral' | 'ephemeralExpiresAt'>>
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

// Obliterate every ephemeral session whose window has passed. Returns the new
// store and the ids removed (for audit/UX). If the active session is purged,
// activeSessionId falls back to the most-recent survivor.
export function purgeExpiredEphemeral(store: SessionStore, nowMs: number): { store: SessionStore; removed: SessionId[] } {
  const removed: SessionId[] = []
  const sessions = { ...store.sessions }
  for (const s of Object.values(store.sessions)) {
    if (s.ephemeral && s.ephemeralExpiresAt && Date.parse(s.ephemeralExpiresAt) <= nowMs) {
      delete sessions[s.id]
      removed.push(s.id)
    }
  }
  if (removed.length === 0) return { store, removed }
  const activeSessionId = store.activeSessionId && sessions[store.activeSessionId]
    ? store.activeSessionId
    : (Object.values(sessions).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]?.id ?? null)
  return { store: { ...store, sessions, activeSessionId }, removed }
}

// Obliterate ALL ephemeral sessions immediately (panic / disarm).
export function obliterateAllEphemeral(store: SessionStore): { store: SessionStore; removed: SessionId[] } {
  const removed = Object.values(store.sessions).filter((s) => s.ephemeral).map((s) => s.id)
  if (removed.length === 0) return { store, removed }
  const sessions = { ...store.sessions }
  for (const id of removed) delete sessions[id]
  const activeSessionId = store.activeSessionId && sessions[store.activeSessionId]
    ? store.activeSessionId
    : (Object.values(sessions).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]?.id ?? null)
  return { store: { ...store, sessions, activeSessionId }, removed }
}

export function sortedSessions(store: SessionStore): WorkspaceSession[] {
  return Object.values(store.sessions).sort((a, b) => {
    if (a.pinned && !b.pinned) return -1
    if (!a.pinned && b.pinned) return 1
    return b.updatedAt.localeCompare(a.updatedAt)
  })
}
