import { requireEnv } from '@/lib/utils/env'
import type { ProviderCallInput, ProviderCallResult } from '@/lib/providers'

export async function callOpenAI(input: ProviderCallInput): Promise<ProviderCallResult> {
  const started = Date.now()
  const apiKey = requireEnv('OPENAI_API_KEY')

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: input.model,
      messages: input.messages.map(({ role, content }) => ({ role, content }))
    })
  })

  if (!response.ok) {
    const details = await response.text()
    throw new Error(`OpenAI request failed: ${response.status} ${details}`)
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }

  return {
    content: payload.choices?.[0]?.message?.content ?? '',
    model_routed: input.model,
    provider: 'openai',
    policy_admitted: true,
    memory_written: false,
    latency_ms: Date.now() - started
  }
}
