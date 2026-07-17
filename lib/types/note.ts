import type { ChatMessage } from '@/lib/types/message'

export interface Note {
  id: string
  title: string
  body: string
  tags: string[]
  /** Chat thread anchored to this note — stored on the note itself, not in the session store. */
  messages: ChatMessage[]
  modelId?: string
  createdAt: string
  updatedAt: string
  pinned?: boolean
}

export interface NoteStore {
  notes: Record<string, Note>
  version: number
}

export const NOTE_STORE_VERSION = 1
export const NOTE_STORE_KEY = 'noetica:notes:v1'
export const NOTE_STORE_KEY_LEGACY = 'noetica:notes'
export const MAX_NOTES = 500
