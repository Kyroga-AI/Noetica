import type { PendingAttachment } from '@/lib/types/attachment'

export type ProjectColor =
  | '#3b82f6' | '#8b5cf6' | '#06b6d4' | '#10b981'
  | '#f59e0b' | '#ef4444' | '#ec4899'

export const PROJECT_COLORS: ProjectColor[] = [
  '#3b82f6', '#8b5cf6', '#06b6d4', '#10b981',
  '#f59e0b', '#ef4444', '#ec4899',
]

export const DEFAULT_PROJECT_COLOR: ProjectColor = '#3b82f6'

export interface Project {
  id: string
  title: string
  color: ProjectColor
  description: string
  systemPrompt: string
  fileAttachments: PendingAttachment[]
  createdAt: string
  updatedAt: string
  pinned?: boolean
}

export interface ProjectStore {
  projects: Record<string, Project>
  activeProjectId: string | null
  version: number
}

export const PROJECT_STORE_VERSION = 1
export const PROJECT_STORE_KEY = 'noetica:projects'

/**
 * The document-collection id for a project's knowledge base. DERIVED from the project id (not stored) so
 * every existing project gets a stable collection with no migration. Uploads made while this project is
 * active land in `collection/<this>/…`, and the chat scopes retrieval to it — that's project isolation.
 */
export const projectCollectionId = (projectId: string): string => `proj-${projectId.replace(/-/g, '').slice(0, 12)}`

/** The per-chat collection id — docs attached to one specific conversation (ranked first / "chat-first"). */
export const chatCollectionId = (sessionId: string): string => `chat-${sessionId.replace(/-/g, '').slice(0, 8)}`

/** Retrieval breadth for a chat: only this chat's docs, this chat + its project KB (default), or everything. */
export type RetrievalScope = 'chat' | 'project' | 'everything'
