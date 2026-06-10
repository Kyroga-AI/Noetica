import { requireEnv } from '@/lib/utils/env'
import type { ProviderCallInput, ProviderCallResult, ProviderStreamInput } from '@/lib/providers'

export async function callOpenAI(input: ProviderCallInput): Promise<ProviderCallResult> {
  const started = Date.now()
  let content = ''

  for await (const delta of streamOpenAI(input)) {
    content += delta
  }

  return {
    content,
    model_routed: input.model,
    provider: 'openai',
    policy_admitted: true,
    memory_written: false,
    latency_ms: Date.now() - started
  }
}

export async function* streamOpenAI(input: ProviderStreamInput & { apiKey?: string }): AsyncGenerator<string> {
  const apiKey = input.apiKey?.trim() || requireEnv('OPENAI_API_KEY')

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: input.model,
      stream: true,
      messages: input.messages.map(({ role, content }) => ({ role, content }))
    })
  })

  if (!response.ok) {
    const details = await response.text()
    throw new Error(`OpenAI request failed: ${response.status} ${details}`)
  }

  if (!response.body) {
    throw new Error('OpenAI response body was empty.')
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
      if (data === '[DONE]') return

      const payload = JSON.parse(data) as {
        choices?: Array<{ delta?: { content?: string } }>
      }
      const delta = payload.choices?.[0]?.delta?.content
      if (delta) yield delta
    }
  }
}
