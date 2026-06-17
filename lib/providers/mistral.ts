import { requireEnv } from '@/lib/utils/env'
import type { ProviderCallInput, ProviderCallResult, ProviderStreamInput } from '@/lib/providers'
import { streamOpenAI } from './openai'

// Mistral's hosted API is OpenAI-compatible (same /v1/chat/completions schema,
// Bearer auth, SSE streaming, function-calling tool format). We delegate to the
// OpenAI streamer with Mistral's base URL and key so tool-call/usage parsing,
// attachment handling, and system-prompt logic stay in one place.
const MISTRAL_BASE_URL = 'https://api.mistral.ai'

export { TOOL_CALLS_PREFIX, USAGE_PREFIX } from './openai'

export async function* streamMistral(input: ProviderStreamInput): AsyncGenerator<string> {
  const apiKey = input.apiKey?.trim() || requireEnv('MISTRAL_API_KEY')
  yield* streamOpenAI({
    ...input,
    apiKey,
    baseUrl: input.baseUrl?.trim() || MISTRAL_BASE_URL,
  })
}

export async function callMistral(input: ProviderCallInput): Promise<ProviderCallResult> {
  const started = Date.now()
  let content = ''
  for await (const delta of streamMistral(input)) {
    if (!delta.startsWith('\x00')) content += delta
  }
  return {
    content,
    model_routed: input.model,
    provider: 'mistral',
    policy_admitted: true,
    memory_written: false,
    latency_ms: Date.now() - started,
  }
}
