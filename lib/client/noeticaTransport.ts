import type {
  NoeticaChatRequest,
  NoeticaMode,
  NoeticaStreamDoneResult,
  NoeticaStreamEvent
} from '@/lib/contracts/noeticaService'
import type { GovernanceTrace } from '@/lib/types/governance'

export type { NoeticaChatRequest, NoeticaMode, NoeticaStreamDoneResult, NoeticaStreamEvent }

export type NoeticaChatTransportHandlers = {
  onMeta: (governance: GovernanceTrace) => void
  onDelta: (delta: string) => void
  onDone: (result: NoeticaStreamDoneResult) => void
  onError: (error: string) => void
}

export type NoeticaTransportConfig = {
  endpoint?: string
}

export async function sendNoeticaChat(
  request: NoeticaChatRequest,
  handlers: NoeticaChatTransportHandlers,
  config: NoeticaTransportConfig = {}
) {
  const endpoint = resolveNoeticaChatEndpoint(config)
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request)
  })

  if (!response.ok || !response.body) {
    const payload = await response.json().catch(() => ({ error: 'unknown_route_error' }))
    handlers.onError(String(payload.error ?? 'unknown_route_error'))
    return
  }

  await readNoeticaEventStream(response, handlers)
}

export function resolveNoeticaChatEndpoint(config: NoeticaTransportConfig = {}) {
  return config.endpoint ?? process.env.NEXT_PUBLIC_NOETICA_CHAT_ENDPOINT ?? '/api/chat'
}

async function readNoeticaEventStream(response: Response, handlers: NoeticaChatTransportHandlers) {
  const reader = response.body?.getReader()
  if (!reader) return

  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const parts = buffer.split('\n\n')
    buffer = parts.pop() ?? ''

    for (const part of parts) {
      const parsed = parseSseEvent(part)
      if (!parsed) continue

      const payload = JSON.parse(parsed.data)
      if (parsed.event === 'meta') handlers.onMeta(payload.governance)
      if (parsed.event === 'delta') handlers.onDelta(payload.delta)
      if (parsed.event === 'done') handlers.onDone(payload.result)
      if (parsed.event === 'error') handlers.onError(payload.error)
    }
  }
}

function parseSseEvent(raw: string): NoeticaStreamEvent | undefined {
  const lines = raw.split('\n')
  const event = lines.find((line) => line.startsWith('event:'))?.slice(6).trim()
  const data = lines.find((line) => line.startsWith('data:'))?.slice(5).trim()

  if (!event || !data) return undefined
  return { event, data }
}
