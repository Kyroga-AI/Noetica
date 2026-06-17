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
