import type { ArtifactStore } from '@/lib/types/artifact'
import { ARTIFACT_STORE_KEY, ARTIFACT_STORE_VERSION } from '@/lib/types/artifact'

export function loadArtifactStore(): ArtifactStore | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(ARTIFACT_STORE_KEY)
    if (!raw) return null
    const parsed: ArtifactStore = JSON.parse(raw)
    if (parsed.version !== ARTIFACT_STORE_VERSION) return null
    return parsed
  } catch {
    return null
  }
}

export function saveArtifactStore(store: ArtifactStore): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(ARTIFACT_STORE_KEY, JSON.stringify(store))
  } catch { /* quota */ }
}
