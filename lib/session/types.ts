import type { ChatMessage } from '@/lib/types/message'
import type { ActiveSurface } from '@/lib/types/surface'
import type { WorkspaceMode } from '@/components/chat/InputArea'

export type SessionId = string

export interface WorkspaceSession {
  id: SessionId
  title: string
  surface: ActiveSurface
  workspaceMode: WorkspaceMode
  messages: ChatMessage[]
  modelId: string
  createdAt: string
  updatedAt: string
  pinned?: boolean
  parentId?: SessionId
  projectId?: string
  // Killer-feature foundation (opt-in community commons): a chat is PRIVATE unless the user explicitly opens it.
  // 'open' chats become searchable by other users' agents via SearXNG. Absent/undefined === 'private' — there is
  // no default-open path, and flipping open→private must revoke from the search index immediately. The toggle UI
  // + the SearXNG engine land later; this field is the data-model anchor so the store carries the bit now.
  visibility?: 'private' | 'open'
  // Ephemeral sessions are created while the security lane is armed. They are
  // obliterated (removed from the store AND from disk) once ephemeralExpiresAt
  // passes — a sliding window refreshed on every message. No memory is written.
  ephemeral?: boolean
  ephemeralExpiresAt?: string
}

export interface SessionStore {
  activeSessionId: SessionId | null
  sessions: Record<SessionId, WorkspaceSession>
  version: number
}

export const SESSION_STORE_VERSION = 1
export const SESSION_STORE_KEY = 'noetica:sessions'
export const MAX_SESSIONS = 50
export const MAX_MESSAGES_PER_SESSION = 500
