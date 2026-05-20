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

export async function* streamAnthropic(input: ProviderStreamInput): AsyncGenerator<string> {
  const apiKey = requireEnv('ANTHROPIC_API_KEY')
  const system = input.messages.find((message) => message.role === 'system')?.content
  const messages = input.messages
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .map(({ role, content }) => ({ role, content }))

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: input.model,
      max_tokens: 2048,
      stream: true,
      system,
      messages
    })
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
        delta?: { text?: string }
      }

      if (payload.type === 'content_block_delta' && payload.delta?.text) {
        yield payload.delta.text
      }
    }
  }
}
