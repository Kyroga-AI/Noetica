import { optionalEnv } from '@/lib/utils/env'
import type { ProviderCallInput, ProviderCallResult, ProviderStreamInput, ProviderTool, ToolUseBlock } from '@/lib/providers'
import type { PendingAttachment } from '@/lib/types/attachment'

export const TOOL_CALLS_PREFIX = '\x00tool_calls\x00'
export const USAGE_PREFIX = '\x00usage\x00'

const DEFAULT_OLLAMA_BASE_URL = 'http://localhost:11434'

// Ollama runs open-weight models locally (Llama 3.x, Mistral, Gemma, Qwen, etc.).
// Its /api/chat endpoint streams newline-delimited JSON (not SSE). It supports
// vision via per-message `images` (base64) and OpenAI-style `tools`. This adapter
// is the real local-inference path for `provider: 'meta'` models and any
// open-weight target the user pulls into their local runtime.

type OllamaMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  images?: string[]
}

function buildOllamaMessages(messages: import('@/lib/types/message').ChatMessage[]): OllamaMessage[] {
  return messages.map((m): OllamaMessage => {
    const base: OllamaMessage = { role: m.role, content: m.content }
    if (m.attachments?.length) {
      const images = m.attachments.filter((a: PendingAttachment) => a.kind === 'image').map((a) => a.base64)
      // Non-image attachments: decode and append to text content
      const textParts = m.attachments
        .filter((a) => a.kind !== 'image')
        .map((a) => `**${a.name}**\n\`\`\`\n${Buffer.from(a.base64, 'base64').toString('utf-8')}\n\`\`\``)
      if (images.length) base.images = images
      if (textParts.length) base.content = [m.content, ...textParts].filter(Boolean).join('\n\n')
    }
    return base
  })
}

export async function* streamOllama(input: ProviderStreamInput): AsyncGenerator<string> {
  const base = input.baseUrl?.replace(/\/$/, '') || optionalEnv('OLLAMA_BASE_URL')?.replace(/\/$/, '') || DEFAULT_OLLAMA_BASE_URL

  let messages = buildOllamaMessages(input.messages)
  if (input.systemPrompt) {
    messages = messages.filter((m) => m.role !== 'system')
    messages.unshift({ role: 'system', content: input.systemPrompt })
  }

  const tools = input.tools?.map((t: ProviderTool) => ({
    type: 'function' as const,
    function: { name: t.name, description: t.description, parameters: t.input_schema },
  }))

  const options: Record<string, unknown> = {}
  if (input.temperature !== undefined) options.temperature = input.temperature
  if (input.top_p !== undefined) options.top_p = input.top_p
  if (input.max_tokens !== undefined) options.num_predict = input.max_tokens

  const body: Record<string, unknown> = {
    model: input.model,
    messages,
    stream: true,
  }
  if (tools?.length) body.tools = tools
  if (Object.keys(options).length > 0) body.options = options

  let response: Response
  try {
    response = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unreachable'
    throw new Error(`Ollama not reachable at ${base} — is the local runtime running? (${msg})`)
  }

  if (!response.ok) {
    const details = await response.text()
    throw new Error(`Ollama request failed: ${response.status} ${details}`)
  }
  if (!response.body) throw new Error('Ollama response body was empty.')

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let inputTokens = 0
  let outputTokens = 0
  const toolCalls: ToolUseBlock[] = []

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue

      try {
        const payload = JSON.parse(trimmed) as {
          message?: {
            content?: string
            tool_calls?: Array<{ function?: { name?: string; arguments?: Record<string, unknown> } }>
          }
          done?: boolean
          prompt_eval_count?: number
          eval_count?: number
        }

        if (payload.message?.content) yield payload.message.content

        if (payload.message?.tool_calls) {
          for (const tc of payload.message.tool_calls) {
            if (!tc.function?.name) continue
            const matchedTool = input.tools?.find((t) => t.name === tc.function!.name)
            toolCalls.push({
              id: `ollama-tc-${toolCalls.length}-${Date.now()}`,
              name: tc.function.name,
              input: tc.function.arguments ?? {},
              serverId: matchedTool?.serverId,
            })
          }
        }

        if (payload.done) {
          inputTokens = payload.prompt_eval_count ?? inputTokens
          outputTokens = payload.eval_count ?? outputTokens
        }
      } catch { /* skip malformed line */ }
    }
  }

  if (toolCalls.length > 0) {
    yield TOOL_CALLS_PREFIX + JSON.stringify(toolCalls)
  }
  if (inputTokens > 0 || outputTokens > 0) {
    yield USAGE_PREFIX + JSON.stringify({ input_tokens: inputTokens, output_tokens: outputTokens })
  }
}

export async function callOllama(input: ProviderCallInput): Promise<ProviderCallResult> {
  const started = Date.now()
  let content = ''
  for await (const delta of streamOllama(input)) {
    if (!delta.startsWith('\x00')) content += delta
  }
  return {
    content,
    model_routed: input.model,
    provider: 'meta',
    policy_admitted: true,
    memory_written: false,
    latency_ms: Date.now() - started,
  }
}
