'use client'

import type { NoeticaChatRequest } from '@/lib/client/noeticaTransport'
import type { NoeticaChatTransportHandlers } from '@/lib/client/noeticaTransport'
import { models } from '@/config/models'

const THINKING_PREFIX = '\x00thinking\x00'

export async function sendNoeticaChatDirect(
  request: NoeticaChatRequest,
  handlers: NoeticaChatTransportHandlers,
  signal?: AbortSignal
): Promise<void> {
  const apiKey = request.provider_keys?.anthropic?.trim()
  if (!apiKey) {
    handlers.onError('No Anthropic API key configured. Add your key in Settings → API Keys.')
    return
  }

  const model = models.find((m) => m.id === request.model_id) ?? models[0]
  const systemMsg = request.messages.find((m) => m.role === 'system')?.content
  const convoMessages = request.messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map(({ role, content }) => ({ role, content }))

  const body: Record<string, unknown> = {
    model: model.id,
    max_tokens: request.thinking_budget ? request.thinking_budget + 4096 : 2048,
    stream: true,
    messages: convoMessages,
  }
  if (systemMsg) body.system = systemMsg
  if (request.thinking_budget) {
    body.thinking = { type: 'enabled', budget_tokens: request.thinking_budget }
  }

  let response: Response
  try {
    response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        ...(request.thinking_budget ? { 'anthropic-beta': 'interleaved-thinking-2025-05-14' } : {}),
      },
      body: JSON.stringify(body),
      signal,
    })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return
    handlers.onError(err instanceof Error ? err.message : 'fetch_failed')
    return
  }

  if (!response.ok || !response.body) {
    const details = await response.text().catch(() => '')
    handlers.onError(`Anthropic error ${response.status}: ${details || 'unknown'}`)
    return
  }

  // Emit a minimal governance trace so the frontend doesn't break
  handlers.onMeta({
    run_id: crypto.randomUUID(),
    model_routed: model.id,
    provider: 'anthropic',
    policy_admitted: true,
    memory_written: false,
    latency_ms: 0,
    timestamp: new Date().toISOString(),
  })

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let inThinkingBlock = false
  let thinkingAccum = ''

  while (true) {
    if (signal?.aborted) { reader.cancel(); break }
    let done: boolean, value: Uint8Array | undefined
    try {
      ;({ done, value } = await reader.read())
    } catch { break }
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) continue
      const data = trimmed.slice(5).trim()
      if (!data || data === '[DONE]') continue

      let payload: {
        type?: string
        content_block?: { type?: string }
        delta?: { type?: string; text?: string; thinking?: string }
        usage?: { input_tokens?: number; output_tokens?: number }
      }
      try { payload = JSON.parse(data) } catch { continue }

      if (payload.type === 'content_block_start') {
        inThinkingBlock = payload.content_block?.type === 'thinking'
        if (inThinkingBlock) thinkingAccum = ''
      }
      if (payload.type === 'content_block_stop') {
        if (inThinkingBlock && thinkingAccum) {
          handlers.onThinkingDone?.(thinkingAccum)
        }
        inThinkingBlock = false
      }
      if (payload.type === 'content_block_delta') {
        if (inThinkingBlock && payload.delta?.thinking) {
          thinkingAccum += payload.delta.thinking
          handlers.onThinkingDelta?.(payload.delta.thinking)
        } else if (!inThinkingBlock && payload.delta?.text) {
          handlers.onDelta(payload.delta.text)
        }
      }
      if (payload.type === 'message_stop') {
        handlers.onDone({
          run_id: crypto.randomUUID(),
          content: '',
          model_routed: model.id,
          provider: 'anthropic',
          policy_admitted: true,
          memory_written: false,
          latency_ms: 0,
        })
      }
    }
  }
}
