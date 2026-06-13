import { requireEnv } from '@/lib/utils/env'
import type { ProviderCallInput, ProviderCallResult, ProviderStreamInput } from '@/lib/providers'

export async function callAnthropic(input: ProviderCallInput): Promise<ProviderCallResult> {
  const started = Date.now()
  let content = ''

  for await (const delta of streamAnthropic(input)) {
    content += delta
  }

  return {
    content,
    model_routed: input.model,
    provider: 'anthropic',
    policy_admitted: true,
    memory_written: false,
    latency_ms: Date.now() - started
  }
}

export const THINKING_PREFIX = '\x00thinking\x00'

export async function* streamAnthropic(input: ProviderStreamInput): AsyncGenerator<string> {
  const apiKey = input.apiKey?.trim() || requireEnv('ANTHROPIC_API_KEY')
  const system = input.messages.find((message) => message.role === 'system')?.content
  const messages = input.messages
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .map(({ role, content }) => ({ role, content }))

  const body: Record<string, unknown> = {
    model: input.model,
    max_tokens: input.thinking_budget ? input.thinking_budget + 4096 : 2048,
    stream: true,
    system,
    messages
  }

  if (input.thinking_budget) {
    body.thinking = { type: 'enabled', budget_tokens: input.thinking_budget }
    body['betas'] = ['interleaved-thinking-2025-05-14']
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      ...(input.thinking_budget ? { 'anthropic-beta': 'interleaved-thinking-2025-05-14' } : {})
    },
    body: JSON.stringify(body)
  })

  if (!response.ok) {
    const details = await response.text()
    throw new Error(`Anthropic request failed: ${response.status} ${details}`)
  }

  if (!response.body) {
    throw new Error('Anthropic response body was empty.')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let inThinkingBlock = false

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) continue

      const data = trimmed.slice(5).trim()
      if (!data || data === '[DONE]') continue

      const payload = JSON.parse(data) as {
        type?: string
        index?: number
        content_block?: { type?: string }
        delta?: { type?: string; text?: string; thinking?: string }
      }

      if (payload.type === 'content_block_start') {
        inThinkingBlock = payload.content_block?.type === 'thinking'
      }

      if (payload.type === 'content_block_stop') {
        inThinkingBlock = false
      }

      if (payload.type === 'content_block_delta') {
        if (inThinkingBlock && payload.delta?.thinking) {
          yield THINKING_PREFIX + payload.delta.thinking
        } else if (!inThinkingBlock && payload.delta?.text) {
          yield payload.delta.text
        }
      }
    }
  }
}
