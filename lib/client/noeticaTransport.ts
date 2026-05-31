import type { GovernanceTrace } from '@/lib/types/governance'
import type { ChatMessage } from '@/lib/types/message'
import type { SteeringConfig } from '@/lib/types/steering'

export type NoeticaMode = 'standalone' | 'sourceos'

export type NoeticaChatRequest = {
  session_id: string
  mode: NoeticaMode
  model_id: string
  messages: ChatMessage[]
  steering?: SteeringConfig
  memory_scope: string
}

export type NoeticaChatTransportHandlers = {
  onMeta: (governance: GovernanceTrace) => void
  onDelta: (delta: string) => void
  onDone: (result: NoeticaStreamDoneResult) => void
  onError: (error: string) => void
}

export type NoeticaStreamEvent = {
  event: string
  data: string
}

export type NoeticaStreamDoneResult = {
  run_id: string
  content: string
  model_routed: string
  provider: string
  model_overridden?: boolean
  policy_admitted: boolean
  policy_ref?: string
  memory_scope_ref?: string
  memory_written: boolean
  evidence_ref?: string
  replay_ref?: string
  agentplane_run_id?: string
  request_hash?: string
  evidence_hash?: string
  provider_route_evidence?: GovernanceTrace['provider_route_evidence']
  grant_refs?: GovernanceTrace['grant_refs']
  sourceos_status?: GovernanceTrace['sourceos_status']
  status?: GovernanceTrace['sourceos_status']
  timestamp?: string
  latency_ms: number
  steering_applied?: ChatMessage['steering_result']
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
