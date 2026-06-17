import { requireEnv } from '@/lib/utils/env'
import type { ProviderCallInput, ProviderCallResult, ProviderStreamInput, ProviderTool, ToolUseBlock } from '@/lib/providers'
import type { PendingAttachment } from '@/lib/types/attachment'

export const TOOL_CALLS_PREFIX = '\x00tool_calls\x00'
export const USAGE_PREFIX = '\x00usage\x00'

// ─── Content part builders ────────────────────────────────────────────────────

type GeminiPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } }
  | { functionCall: { name: string; args: Record<string, unknown> } }

function attachmentToParts(att: PendingAttachment): GeminiPart[] {
  if (att.kind === 'image' || att.kind === 'pdf') {
    return [{ inlineData: { mimeType: att.mimeType, data: att.base64 } }]
  }
  // text / code — decode and inject as fenced block
  const text = Buffer.from(att.base64, 'base64').toString('utf-8')
  return [{ text: `**${att.name}**\n\`\`\`\n${text}\n\`\`\`` }]
}

type GeminiContent = { role: 'user' | 'model'; parts: GeminiPart[] }

function buildGeminiContents(messages: import('@/lib/types/message').ChatMessage[]): GeminiContent[] {
  return messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m): GeminiContent => {
      const role = m.role === 'assistant' ? 'model' : 'user'
      if (!m.attachments?.length) return { role, parts: [{ text: m.content }] }
      const parts: GeminiPart[] = m.attachments.flatMap(attachmentToParts)
      if (m.content) parts.push({ text: m.content })
      return { role, parts }
    })
}

// ─── Streaming ────────────────────────────────────────────────────────────────

export async function* streamGoogle(input: ProviderStreamInput): AsyncGenerator<string> {
  const apiKey = input.apiKey?.trim() || requireEnv('GOOGLE_API_KEY')

  const base = input.baseUrl?.replace(/\/$/, '') || 'https://generativelanguage.googleapis.com'
  const url = `${base}/v1beta/models/${input.model}:streamGenerateContent?alt=sse&key=${apiKey}`

  const contents = buildGeminiContents(input.messages)

  // System prompt: explicit override > system message in history
  const systemInstruction = input.systemPrompt
    ?? input.messages.find((m) => m.role === 'system')?.content

  // Gemini function-calling: tools carry a functionDeclarations array
  const tools = input.tools?.length
    ? [{
        functionDeclarations: input.tools.map((t: ProviderTool) => ({
          name: t.name,
          description: t.description,
          parameters: t.input_schema,
        })),
      }]
    : undefined

  const generationConfig: Record<string, unknown> = {}
  if (input.temperature !== undefined) generationConfig.temperature = input.temperature
  if (input.top_p !== undefined) generationConfig.topP = input.top_p
  if (input.max_tokens !== undefined) generationConfig.maxOutputTokens = input.max_tokens

  const body: Record<string, unknown> = { contents }
  if (systemInstruction) body.systemInstruction = { parts: [{ text: systemInstruction }] }
  if (tools) body.tools = tools
  if (Object.keys(generationConfig).length > 0) body.generationConfig = generationConfig

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
  let inputTokens = 0
  let outputTokens = 0
  const functionCalls: ToolUseBlock[] = []

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
            content?: { parts?: Array<{ text?: string; functionCall?: { name: string; args?: Record<string, unknown> } }> }
          }>
          usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number }
        }

        if (payload.usageMetadata) {
          inputTokens = payload.usageMetadata.promptTokenCount ?? inputTokens
          outputTokens = payload.usageMetadata.candidatesTokenCount ?? outputTokens
        }

        const parts = payload.candidates?.[0]?.content?.parts ?? []
        for (const part of parts) {
          if (part.text) {
            yield part.text
          } else if (part.functionCall) {
            const matchedTool = input.tools?.find((t) => t.name === part.functionCall!.name)
            functionCalls.push({
              id: `gemini-fc-${functionCalls.length}-${Date.now()}`,
              name: part.functionCall.name,
              input: part.functionCall.args ?? {},
              serverId: matchedTool?.serverId,
            })
          }
        }
      } catch { /* skip malformed chunk */ }
    }
  }

  if (functionCalls.length > 0) {
    yield TOOL_CALLS_PREFIX + JSON.stringify(functionCalls)
  }
  if (inputTokens > 0 || outputTokens > 0) {
    yield USAGE_PREFIX + JSON.stringify({ input_tokens: inputTokens, output_tokens: outputTokens })
  }
}

export async function callGoogle(input: ProviderCallInput): Promise<ProviderCallResult> {
  const started = Date.now()
  let content = ''
  for await (const delta of streamGoogle(input)) {
    if (!delta.startsWith('\x00')) content += delta
  }
  return {
    content,
    model_routed: input.model,
    provider: 'google',
    policy_admitted: true,
    memory_written: false,
    latency_ms: Date.now() - started,
  }
}
