export interface MemoryEntry {
  id: string
  text: string
  tags: string[]
  created_at: string
  session_id?: string
  source: 'user' | 'auto'
  embedding?: number[]
}

export interface MemoryStore {
  version: number
  entries: MemoryEntry[]
}

export const MEMORY_STORE_VERSION = 1
export const MEMORY_STORE_KEY = 'noetica:memory'
