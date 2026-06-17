import type { NoeticaServiceStatus } from '@/lib/contracts/noeticaService'

export type NoeticaStatusState =
  | { state: 'loading'; status?: undefined; error?: undefined }
  | { state: 'ready'; status: NoeticaServiceStatus; error?: undefined }
  | { state: 'error'; status?: undefined; error: string }

// In Tauri desktop mode, fetch from agent-machine's live /api/status so the
// status bar reflects the real runtime (not the static browser-fallback stub).
function resolveStatusEndpoint(): string {
  if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
    return 'http://127.0.0.1:8080/api/status'
  }
  return '/api/status'
}

export async function loadNoeticaStatus(endpoint?: string): Promise<NoeticaServiceStatus> {
  const url = endpoint ?? resolveStatusEndpoint()
  const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(2000) })

  if (!response.ok) {
    throw new Error(`status_endpoint_${response.status}`)
  }

  return (await response.json()) as NoeticaServiceStatus
}
