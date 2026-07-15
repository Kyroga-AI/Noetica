import { requireEnv } from '@/lib/utils/env'
import type { ProviderCallInput, ProviderCallResult, ProviderStreamInput, ProviderTool, ToolUseBlock } from '@/lib/providers'
import type { PendingAttachment } from '@/lib/types/attachment'

export async function callAnthropic(input: ProviderCallInput): Promise<ProviderCallResult> {
  const started = Date.now()
  let content = ''

  for await (const delta of streamAnthropic(input)) {
    if (!delta.startsWith('\x00')) content += delta
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
export const TOOL_CALLS_PREFIX = '\x00tool_calls\x00'
export const USAGE_PREFIX = '\x00usage\x00'

// ─── Content block builders ───────────────────────────────────────────────────

type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
  | { type: 'document'; source: { type: 'base64'; media_type: 'application/pdf'; data: string } }
  | { type: 'tool_result'; tool_use_id: string; content: string }

function attachmentToBlocks(att: PendingAttachment): AnthropicContentBlock[] {
  if (att.kind === 'image') {
    return [{ type: 'image', source: { type: 'base64', media_type: att.mimeType, data: att.base64 } }]
  }
  if (att.kind === 'pdf') {
    return [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: att.base64 } }]
  }
  // text / code — decode base64 and inject as fenced block
  const text = Buffer.from(att.base64, 'base64').toString('utf-8')
  return [{ type: 'text', text: `**${att.name}**\n\`\`\`\n${text}\n\`\`\`` }]
}

type AnthropicMessage = {
  role: 'user' | 'assistant'
  content: string | AnthropicContentBlock[]
}

function buildAnthropicMessages(messages: import('@/lib/types/message').ChatMessage[]): AnthropicMessage[] {
  return messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => {
      if (!m.attachments?.length) return { role: m.role as 'user' | 'assistant', content: m.content }
      const blocks: AnthropicContentBlock[] = m.attachments.flatMap(attachmentToBlocks)
      if (m.content) blocks.push({ type: 'text', text: m.content })
      return { role: m.role as 'user' | 'assistant', content: blocks }
    })
}

// ─── Streaming ────────────────────────────────────────────────────────────────

export async function* streamAnthropic(input: ProviderStreamInput): AsyncGenerator<string> {
  const apiKey = input.apiKey?.trim() || requireEnv('ANTHROPIC_API_KEY')

  // System prompt: explicit override > system message in history
  const systemMessage = input.systemPrompt
    ?? input.messages.find((m) => m.role === 'system')?.content

  const messages = buildAnthropicMessages(input.messages)

  // Build tools array for Anthropic
  const tools = input.tools?.map((t: ProviderTool) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema,
  }))

  const body: Record<string, unknown> = {
    model: input.model,
    max_tokens: input.max_tokens ?? (input.thinking_budget ? input.thinking_budget + 4096 : 8192),
    stream: true,
    system: systemMessage,
    messages,
    ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
    ...(input.top_p       !== undefined ? { top_p:       input.top_p       } : {}),
  }

  if (tools?.length) body.tools = tools
  if (input.thinking_budget) {
    body.thinking = { type: 'enabled', budget_tokens: input.thinking_budget }
  }

  const endpoint = input.baseUrl
    ? `${input.baseUrl.replace(/\/$/, '')}/v1/messages`
    : 'https://api.anthropic.com/v1/messages'
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      ...(input.thinking_budget ? { 'anthropic-beta': 'interleaved-thinking-2025-05-14' } : {}),
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const details = await response.text()
    throw new Error(`Anthropic request failed: ${response.status} ${details}`)
  }
  if (!response.body) throw new Error('Anthropic response body was empty.')

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let inThinkingBlock = false
  let inputTokens = 0
  let outputTokens = 0

  // Tool use tracking
  type PartialToolUse = { id: string; name: string; inputJson: string; serverId?: string }
  const toolUseBlocks = new Map<number, PartialToolUse>()
  let currentBlockIndex = -1
  let isToolUseBlock = false

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
        content_block?: { type?: string; id?: string; name?: string }
        delta?: { type?: string; text?: string; thinking?: string; partial_json?: string; stop_reason?: string; usage?: { output_tokens?: number } }
        message?: { stop_reason?: string; usage?: { input_tokens?: number; output_tokens?: number } }
        usage?: { input_tokens?: number; output_tokens?: number }
      }

      if (payload.type === 'message_start' && payload.message?.usage) {
        inputTokens = payload.message.usage.input_tokens ?? 0
        outputTokens = payload.message.usage.output_tokens ?? 0
      }

      if (payload.type === 'message_delta' && payload.usage) {
        outputTokens = payload.usage.output_tokens ?? outputTokens
      }

      if (payload.type === 'content_block_start') {
        currentBlockIndex = payload.index ?? -1
        const blockType = payload.content_block?.type
        inThinkingBlock = blockType === 'thinking'
        isToolUseBlock = blockType === 'tool_use'

        if (isToolUseBlock && payload.content_block?.id && payload.content_block?.name) {
          // Find matching tool to get serverId
          const matchedTool = input.tools?.find((t) => t.name === payload.content_block!.name)
          toolUseBlocks.set(currentBlockIndex, {
            id: payload.content_block.id,
            name: payload.content_block.name,
            inputJson: '',
            serverId: matchedTool?.serverId,
          })
        }
      }

      if (payload.type === 'content_block_stop') {
        inThinkingBlock = false
        isToolUseBlock = false
      }

      if (payload.type === 'content_block_delta') {
        if (inThinkingBlock && payload.delta?.thinking) {
          yield THINKING_PREFIX + payload.delta.thinking
        } else if (!inThinkingBlock && !isToolUseBlock && payload.delta?.text) {
          yield payload.delta.text
        } else if (isToolUseBlock && payload.delta?.partial_json) {
          const block = toolUseBlocks.get(currentBlockIndex)
          if (block) block.inputJson += payload.delta.partial_json
        }
      }

      if (payload.type === 'message_delta' && payload.delta?.stop_reason === 'tool_use') {
        // Emit assembled tool calls
        const calls: ToolUseBlock[] = Array.from(toolUseBlocks.values()).map((b) => ({
          id: b.id,
          name: b.name,
          input: (() => { try { return JSON.parse(b.inputJson) as Record<string, unknown> } catch { return {} } })(),
          serverId: b.serverId,
        }))
        if (calls.length > 0) {
          yield TOOL_CALLS_PREFIX + JSON.stringify(calls)
        }
      }
    }
  }
  if (inputTokens > 0 || outputTokens > 0) {
    yield USAGE_PREFIX + JSON.stringify({ input_tokens: inputTokens, output_tokens: outputTokens })
  }
}
