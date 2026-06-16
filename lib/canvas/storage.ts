import type { CanvasStore } from '@/lib/types/canvas'
import { CANVAS_STORE_KEY, CANVAS_STORE_VERSION } from '@/lib/types/canvas'

const empty: CanvasStore = { documents: {}, activeDocumentId: null, version: CANVAS_STORE_VERSION }

export function loadCanvasStore(): CanvasStore {
  if (typeof window === 'undefined') return empty
  try {
    const raw = localStorage.getItem(CANVAS_STORE_KEY)
    if (!raw) return empty
    const parsed = JSON.parse(raw) as CanvasStore
    if (parsed.version !== CANVAS_STORE_VERSION) return empty
    return parsed
  } catch {
    return empty
  }
}

export function saveCanvasStore(store: CanvasStore): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(CANVAS_STORE_KEY, JSON.stringify(store))
  } catch {
    // quota exceeded — silently ignore
  }
}
