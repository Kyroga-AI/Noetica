import type { PendingAttachment } from '@/lib/types/attachment'

export type ProjectColor =
  | '#3b82f6' | '#8b5cf6' | '#06b6d4' | '#10b981'
  | '#f59e0b' | '#ef4444' | '#ec4899' | '#64748b'

export const PROJECT_COLORS: ProjectColor[] = [
  '#3b82f6', '#8b5cf6', '#06b6d4', '#10b981',
  '#f59e0b', '#ef4444', '#ec4899', '#64748b',
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
