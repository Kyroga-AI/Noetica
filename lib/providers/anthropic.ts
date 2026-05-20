import { requireEnv } from '@/lib/utils/env'
import type { ProviderCallInput, ProviderCallResult } from '@/lib/providers'

export async function callAnthropic(input: ProviderCallInput): Promise<ProviderCallResult> {
  const started = Date.now()
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
      system,
      messages
    })
  })

  if (!response.ok) {
    const details = await response.text()
    throw new Error(`Anthropic request failed: ${response.status} ${details}`)
  }

  const payload = (await response.json()) as {
    content?: Array<{ type: string; text?: string }>
  }

  return {
    content: payload.content?.find((block) => block.type === 'text')?.text ?? '',
    model_routed: input.model,
    provider: 'anthropic',
    policy_admitted: true,
    memory_written: false,
    latency_ms: Date.now() - started
  }
}
