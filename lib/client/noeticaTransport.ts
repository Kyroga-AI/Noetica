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
  onIntent?: (intent: import('@/lib/types/message').IntentTrace) => void
  onGrounding?: (grounding: import('@/lib/types/message').GroundingTrace) => void
  onNarration?: (line: import('@/lib/types/message').NarrationLine) => void
  onPlan?: (plan: import('@/lib/types/message').ExecutionPlan) => void
  onStep?: (step: import('@/lib/types/message').PlanStepUpdate) => void
  onRetrieval?: (trace: import('@/lib/types/message').RetrievalTrace) => void
  onValueJudgment?: (vj: import('@/lib/types/message').ValueJudgment) => void
  onDiscipline?: (d: import('@/lib/types/message').DisciplineTrace) => void
  onDeliberation?: (d: import('@/lib/types/message').Deliberation) => void
  onDone: (result: NoeticaStreamDoneResult) => void
  onError: (error: string) => void
}

export type NoeticaTransportConfig = {
  endpoint?: string
}

const SSE_RECONNECT_DELAYS_MS = [1000, 2000, 4000, 8000]

export async function sendNoeticaChat(
  request: NoeticaChatRequest,
  handlers: NoeticaChatTransportHandlers,
  config: NoeticaTransportConfig = {},
  signal?: AbortSignal
) {
  if (isTauri()) {
    // Always route through agent-machine in Tauri — it's always local on 8080.
    const amBase = (request.agent_machine_endpoint ?? 'http://127.0.0.1:8080').replace(/\/$/, '')
    return sendToNoeticaEndpoint(`${amBase}/api/chat`, request, handlers, signal)
  }

  // Browser path — /api/chat handles agent_machine_endpoint proxying server-side (avoids CORS).
  const endpoint = resolveNoeticaChatEndpoint(config)

  for (let attempt = 0; attempt <= SSE_RECONNECT_DELAYS_MS.length; attempt++) {
    if (signal?.aborted) return
    if (attempt > 0) {
      const delay = SSE_RECONNECT_DELAYS_MS[attempt - 1]!
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, delay)
        signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('AbortError', 'AbortError')) }, { once: true })
      }).catch(() => { return })
      if (signal?.aborted) return
    }

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
      // Transient network error — retry if attempts remain
      if (attempt < SSE_RECONNECT_DELAYS_MS.length) continue
      handlers.onError(err instanceof Error ? err.message : 'fetch_failed')
      return
    }

    if (!response.ok || !response.body) {
      const payload = await response.json().catch(() => ({ error: 'unknown_route_error' }))
      // Retry on 502/503/504 gateway errors; surface all others immediately
      if ((response.status === 502 || response.status === 503 || response.status === 504) && attempt < SSE_RECONNECT_DELAYS_MS.length) continue
      handlers.onError(String(payload.error ?? 'unknown_route_error'))
      return
    }

    await readNoeticaEventStream(response, handlers, signal)
    return
  }
}

export function resolveNoeticaChatEndpoint(config: NoeticaTransportConfig = {}) {
  return config.endpoint ?? process.env.NEXT_PUBLIC_NOETICA_CHAT_ENDPOINT ?? '/api/chat'
}

// Send a request to any endpoint that speaks the Noetica SSE protocol.
// Used for agent-machine direct routing in Tauri mode.
async function sendToNoeticaEndpoint(
  url: string,
  request: NoeticaChatRequest,
  handlers: NoeticaChatTransportHandlers,
  signal?: AbortSignal
) {
  // Strip agent_machine_endpoint to prevent recursion if the AM calls back via /api/chat
  const { agent_machine_endpoint: _dropped, ...forwardRequest } = request
  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(forwardRequest),
      signal,
    })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return
    handlers.onError(err instanceof Error ? err.message : 'agent_machine_unreachable')
    return
  }

  if (!response.ok || !response.body) {
    const payload = await response.json().catch(() => ({ error: 'agent_machine_error' }))
    handlers.onError(String(payload.error ?? 'agent_machine_error'))
    return
  }

  await readNoeticaEventStream(response, handlers, signal)
}

async function readNoeticaEventStream(response: Response, handlers: NoeticaChatTransportHandlers, signal?: AbortSignal) {
  const reader = response.body?.getReader()
  if (!reader) return

  const decoder = new TextDecoder()
  let buffer = ''
  let receivedDone = false

  while (true) {
    if (signal?.aborted) { reader.cancel(); break }
    let done: boolean, value: Uint8Array | undefined
    try {
      ;({ done, value } = await reader.read())
    } catch (err) {
      if (signal?.aborted) break
      // Only surface as error if we never got a done event (partial stream loss)
      if (!receivedDone) {
        handlers.onError(err instanceof Error ? err.message : 'stream_read_error')
      }
      break
    }
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const parts = buffer.split('\n\n')
    buffer = parts.pop() ?? ''

    for (const part of parts) {
      const parsed = parseSseEvent(part)
      if (!parsed) continue

      let payload: Record<string, unknown>
      try { payload = JSON.parse(parsed.data) } catch { continue }
      if (parsed.event === 'meta') handlers.onMeta(payload['governance'] as GovernanceTrace)
      if (parsed.event === 'delta') handlers.onDelta(payload['delta'] as string)
      if (parsed.event === 'thinking_delta') handlers.onThinkingDelta?.(payload['delta'] as string)
      if (parsed.event === 'thinking_done') handlers.onThinkingDone?.(payload['thinking'] as string)
      if (parsed.event === 'tool_calls') handlers.onToolCalls?.(payload['tool_calls'] as import('@/lib/providers').ToolUseBlock[])
      if (parsed.event === 'intent') handlers.onIntent?.(payload['intent'] as import('@/lib/types/message').IntentTrace)
      if (parsed.event === 'grounding') handlers.onGrounding?.(payload['grounding'] as import('@/lib/types/message').GroundingTrace)
      if (parsed.event === 'narration') handlers.onNarration?.(payload['narration'] as import('@/lib/types/message').NarrationLine)
      if (parsed.event === 'plan') handlers.onPlan?.(payload['plan'] as import('@/lib/types/message').ExecutionPlan)
      if (parsed.event === 'step') handlers.onStep?.(payload['step'] as import('@/lib/types/message').PlanStepUpdate)
      if (parsed.event === 'retrieval') handlers.onRetrieval?.(payload['trace'] as import('@/lib/types/message').RetrievalTrace)
      if (parsed.event === 'value_judgment') handlers.onValueJudgment?.(payload['value_judgment'] as import('@/lib/types/message').ValueJudgment)
      if (parsed.event === 'discipline') handlers.onDiscipline?.(payload['discipline'] as import('@/lib/types/message').DisciplineTrace)
      if (parsed.event === 'deliberation') handlers.onDeliberation?.(payload['deliberation'] as import('@/lib/types/message').Deliberation)
      if (parsed.event === 'done') {
        receivedDone = true
        // Capture verification + citations off the done event. agent-machine may emit
        // them on `result.*` or top-level on the done payload — read both, prefer result.
        const result = (payload['result'] ?? {}) as NoeticaStreamDoneResult
        const verification = result.verification ?? (payload['verification'] as NoeticaStreamDoneResult['verification'])
        const citations = result.citations ?? (payload['citations'] as NoeticaStreamDoneResult['citations'])
        handlers.onDone({
          ...result,
          ...(verification ? { verification } : {}),
          ...(citations ? { citations } : {}),
        })
      }
      if (parsed.event === 'error') handlers.onError(payload['error'] as string)
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
