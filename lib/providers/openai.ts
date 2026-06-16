import { requireEnv } from '@/lib/utils/env'
import type { ProviderCallInput, ProviderCallResult, ProviderStreamInput, ProviderTool, ToolUseBlock } from '@/lib/providers'
import type { PendingAttachment } from '@/lib/types/attachment'

export const TOOL_CALLS_PREFIX = '\x00tool_calls\x00'

export async function callOpenAI(input: ProviderCallInput): Promise<ProviderCallResult> {
  const started = Date.now()
  let content = ''

  for await (const delta of streamOpenAI(input)) {
    if (!delta.startsWith('\x00')) content += delta
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

// ─── Content part builders ────────────────────────────────────────────────────

type OpenAIContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail?: 'auto' | 'high' | 'low' } }

function attachmentToParts(att: PendingAttachment): OpenAIContentPart[] {
  if (att.kind === 'image') {
    return [{ type: 'image_url', image_url: { url: `data:${att.mimeType};base64,${att.base64}`, detail: 'auto' } }]
  }
  // For non-images: decode and inject as text
  const text = Buffer.from(att.base64, 'base64').toString('utf-8')
  return [{ type: 'text', text: `**${att.name}**\n\`\`\`\n${text}\n\`\`\`` }]
}

type OpenAIMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string | OpenAIContentPart[] }
  | { role: 'assistant'; content: string | null; tool_calls?: OpenAIToolCall[] }
  | { role: 'tool'; content: string; tool_call_id: string }

type OpenAIToolCall = {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

function buildOpenAIMessages(messages: import('@/lib/types/message').ChatMessage[]): OpenAIMessage[] {
  return messages.map((m): OpenAIMessage => {
    if (m.role === 'system') return { role: 'system', content: m.content }
    if (m.role === 'assistant') return { role: 'assistant', content: m.content }
    // user message with possible attachments
    if (!m.attachments?.length) return { role: 'user', content: m.content }
    const parts: OpenAIContentPart[] = m.attachments.flatMap(attachmentToParts)
    if (m.content) parts.push({ type: 'text', text: m.content })
    return { role: 'user', content: parts }
  })
}

// ─── Streaming ────────────────────────────────────────────────────────────────

export async function* streamOpenAI(input: ProviderStreamInput & { apiKey?: string }): AsyncGenerator<string> {
  const apiKey = input.apiKey?.trim() || requireEnv('OPENAI_API_KEY')

  let messages = buildOpenAIMessages(input.messages)

  // Prepend explicit system prompt if provided (overrides any system message)
  if (input.systemPrompt) {
    messages = messages.filter((m) => m.role !== 'system')
    messages.unshift({ role: 'system', content: input.systemPrompt })
  }

  const tools = input.tools?.map((t: ProviderTool) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    },
  }))

  const body: Record<string, unknown> = {
    model: input.model,
    stream: true,
    messages,
  }
  if (tools?.length) {
    body.tools = tools
    body.tool_choice = 'auto'
  }

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const details = await response.text()
    throw new Error(`OpenAI request failed: ${response.status} ${details}`)
  }
  if (!response.body) throw new Error('OpenAI response body was empty.')

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  // Accumulate streaming tool_calls
  type PartialToolCall = { id: string; name: string; argsJson: string }
  const toolCallMap = new Map<number, PartialToolCall>()

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
      if (data === '[DONE]') {
        // Emit any accumulated tool calls
        if (toolCallMap.size > 0) {
          const calls: ToolUseBlock[] = Array.from(toolCallMap.entries())
            .sort(([a], [b]) => a - b)
            .map(([, tc]) => {
              const matchedTool = input.tools?.find((t) => t.name === tc.name)
              return {
                id: tc.id,
                name: tc.name,
                input: (() => { try { return JSON.parse(tc.argsJson) as Record<string, unknown> } catch { return {} } })(),
                serverId: matchedTool?.serverId,
              }
            })
          yield TOOL_CALLS_PREFIX + JSON.stringify(calls)
        }
        return
      }

      const payload = JSON.parse(data) as {
        choices?: Array<{
          delta?: {
            content?: string
            tool_calls?: Array<{
              index: number
              id?: string
              function?: { name?: string; arguments?: string }
            }>
          }
          finish_reason?: string
        }>
      }

      const choice = payload.choices?.[0]
      const delta = choice?.delta

      // Stream text content
      if (delta?.content) yield delta.content

      // Accumulate tool_calls deltas
      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          const existing = toolCallMap.get(tc.index)
          if (!existing) {
            toolCallMap.set(tc.index, {
              id: tc.id ?? '',
              name: tc.function?.name ?? '',
              argsJson: tc.function?.arguments ?? '',
            })
          } else {
            if (tc.id) existing.id = tc.id
            if (tc.function?.name) existing.name += tc.function.name
            if (tc.function?.arguments) existing.argsJson += tc.function.arguments
          }
        }
      }
    }
  }
}
