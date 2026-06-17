export interface CanvasDocument {
  id: string
  title: string
  content: string   // markdown
  createdAt: string
  updatedAt: string
  pinned?: boolean
}

export interface CanvasStore {
  documents: Record<string, CanvasDocument>
  activeDocumentId: string | null
  version: number
}

export const CANVAS_STORE_KEY = 'noetica:canvas'
export const CANVAS_STORE_VERSION = 1
export const CANVAS_WRITE_EVENT = 'noetica:canvas:write'
