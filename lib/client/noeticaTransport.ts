import type {
  NoeticaChatRequest,
  NoeticaMode,
  NoeticaStreamDoneResult,
  NoeticaStreamEvent
} from '@/lib/contracts/noeticaService'
import type { GovernanceTrace } from '@/lib/types/governance'
import { isTauri } from '@/lib/tauri/bridge'
import { sendNoeticaChatDirect } from '@/lib/client/anthropicDirect'

export type { NoeticaChatRequest, NoeticaMode, NoeticaStreamDoneResult, NoeticaStreamEvent }

export type NoeticaChatTransportHandlers = {
  onMeta: (governance: GovernanceTrace) => void
  onDelta: (delta: string) => void
  onThinkingDelta?: (delta: string) => void
  onThinkingDone?: (thinking: string) => void
  onToolCalls?: (calls: import('@/lib/providers').ToolUseBlock[]) => void
  onDone: (result: NoeticaStreamDoneResult) => void
  onError: (error: string) => void
}

export type NoeticaTransportConfig = {
  endpoint?: string
}

export async function sendNoeticaChat(
  request: NoeticaChatRequest,
  handlers: NoeticaChatTransportHandlers,
  config: NoeticaTransportConfig = {},
  signal?: AbortSignal
) {
  if (isTauri()) {
    return sendNoeticaChatDirect(request, handlers, signal)
  }

  const endpoint = resolveNoeticaChatEndpoint(config)
  let response: Response
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
      signal,
    })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return
    handlers.onError(err instanceof Error ? err.message : 'fetch_failed')
    return
  }

  if (!response.ok || !response.body) {
    const payload = await response.json().catch(() => ({ error: 'unknown_route_error' }))
    handlers.onError(String(payload.error ?? 'unknown_route_error'))
    return
  }

  await readNoeticaEventStream(response, handlers, signal)
}

export function resolveNoeticaChatEndpoint(config: NoeticaTransportConfig = {}) {
  return config.endpoint ?? process.env.NEXT_PUBLIC_NOETICA_CHAT_ENDPOINT ?? '/api/chat'
}

async function readNoeticaEventStream(response: Response, handlers: NoeticaChatTransportHandlers, signal?: AbortSignal) {
  const reader = response.body?.getReader()
  if (!reader) return

  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    if (signal?.aborted) { reader.cancel(); break }
    let done: boolean, value: Uint8Array | undefined
    try {
      ;({ done, value } = await reader.read())
    } catch {
      break
    }
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
      if (parsed.event === 'thinking_delta') handlers.onThinkingDelta?.(payload.delta)
      if (parsed.event === 'thinking_done') handlers.onThinkingDone?.(payload.thinking)
      if (parsed.event === 'tool_calls') handlers.onToolCalls?.(payload.tool_calls)
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
