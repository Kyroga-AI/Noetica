import type { NoeticaServiceStatus } from '@/lib/contracts/noeticaService'

export type NoeticaStatusState =
  | { state: 'loading'; status?: undefined; error?: undefined }
  | { state: 'ready'; status: NoeticaServiceStatus; error?: undefined }
  | { state: 'error'; status?: undefined; error: string }

export async function loadNoeticaStatus(endpoint = '/api/status'): Promise<NoeticaServiceStatus> {
  const response = await fetch(endpoint, { cache: 'no-store' })

  if (!response.ok) {
    throw new Error(`status_endpoint_${response.status}`)
  }

  return (await response.json()) as NoeticaServiceStatus
}
