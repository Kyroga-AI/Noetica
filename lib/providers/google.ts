import { optionalEnv } from '@/lib/utils/env'
import type { ProviderStreamInput } from '@/lib/providers'

export async function* streamGoogle(
  input: ProviderStreamInput & { apiKey?: string }
): AsyncGenerator<string> {
  const apiKey = input.apiKey?.trim() || optionalEnv('GOOGLE_API_KEY')
  if (!apiKey) throw new Error('Google API key not configured — add it in Settings → Models.')

  // Gemini uses the model id without the "gemini-" prefix in some paths;
  // the models API accepts the full id as-is.
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${input.model}:streamGenerateContent?alt=sse&key=${apiKey}`

  const contents = input.messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }))

  const systemInstruction = input.messages.find((m) => m.role === 'system')?.content

  const body: Record<string, unknown> = { contents }
  if (systemInstruction) {
    body.systemInstruction = { parts: [{ text: systemInstruction }] }
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const details = await response.text()
    throw new Error(`Google Gemini request failed: ${response.status} ${details}`)
  }
  if (!response.body) throw new Error('Google Gemini response body was empty.')

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

      try {
        const payload = JSON.parse(data) as {
          candidates?: Array<{
            content?: { parts?: Array<{ text?: string }> }
          }>
        }
        const text = payload.candidates?.[0]?.content?.parts?.[0]?.text
        if (text) yield text
      } catch { /* skip malformed chunk */ }
    }
  }
}
