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
  /** The graph Document id from the last successful "Index" — set once ingestion actually completes
   *  (not just enqueues), so re-indexing can hide this prior version instead of leaving it orphaned. */
  indexedDocId?: string
  indexedAt?: string
  /** The exact "# title\n\nbody" markdown that was indexed, so the UI can tell whether the note has
   *  changed since and show a stale/"re-index" state instead of a false "Indexed" checkmark. */
  indexedSnapshot?: string
}

export interface NoteStore {
  notes: Record<string, Note>
  version: number
}

export const NOTE_STORE_VERSION = 1
export const NOTE_STORE_KEY = 'noetica:notes'
export const MAX_NOTES = 500
