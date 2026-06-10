import { optionalEnv } from '@/lib/utils/env'
import type { ProviderStreamInput } from '@/lib/providers'

export async function* streamMistral(
  input: ProviderStreamInput & { apiKey?: string }
): AsyncGenerator<string> {
  const apiKey = input.apiKey?.trim() || optionalEnv('MISTRAL_API_KEY')
  if (!apiKey) throw new Error('Mistral API key not configured — add it in Settings → Models.')

  const response = await fetch('https://api.mistral.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: input.model,
      stream: true,
      messages: input.messages.map(({ role, content }) => ({ role, content })),
    }),
  })

  if (!response.ok) {
    const details = await response.text()
    throw new Error(`Mistral request failed: ${response.status} ${details}`)
  }
  if (!response.body) throw new Error('Mistral response body was empty.')

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

      try {
        const payload = JSON.parse(data) as {
          choices?: Array<{ delta?: { content?: string } }>
        }
        const delta = payload.choices?.[0]?.delta?.content
        if (delta) yield delta
      } catch { /* skip malformed chunk */ }
    }
  }
}
