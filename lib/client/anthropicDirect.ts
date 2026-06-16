'use client'

import type { NoeticaChatRequest, NoeticaChatTransportHandlers } from '@/lib/client/noeticaTransport'
import type { ToolUseBlock } from '@/lib/providers'
import { streamAnthropic, TOOL_CALLS_PREFIX as ANTHROPIC_TOOL_PFX } from '@/lib/providers/anthropic'
import { streamOpenAI, TOOL_CALLS_PREFIX as OPENAI_TOOL_PFX } from '@/lib/providers/openai'
import { models } from '@/config/models'
import { webSearch } from '@/lib/tools/webSearch'
import { generateImage } from '@/lib/tools/generateImage'
import { isTauri } from '@/lib/tauri/bridge'

const THINKING_PFX = '\x00thinking\x00'

// Full-featured Anthropic/OpenAI client that runs directly from the browser (Tauri mode).
// Mirrors the capabilities of /api/chat without requiring a server.
export async function sendNoeticaChatDirect(
  request: NoeticaChatRequest,
  handlers: NoeticaChatTransportHandlers,
  signal?: AbortSignal
): Promise<void> {
  const model = models.find((m) => m.id === request.model_id) ?? models[0]
  const isOpenAI = model.provider === 'openai'

  const apiKey = (isOpenAI
    ? request.provider_keys?.openai
    : request.provider_keys?.anthropic
  )?.trim()

  if (!apiKey) {
    handlers.onError(
      `No ${isOpenAI ? 'OpenAI' : 'Anthropic'} API key configured. Add your key in Settings → API Keys.`
    )
    return
  }

  const run_id = crypto.randomUUID()
  const timestamp = new Date().toISOString()
  const started = Date.now()

  handlers.onMeta({
    run_id,
    model_routed: model.id,
    provider: model.provider,
    policy_admitted: true,
    memory_written: false,
    latency_ms: 0,
    timestamp,
  })

  const TOOL_PFX = isOpenAI ? OPENAI_TOOL_PFX : ANTHROPIC_TOOL_PFX

  const providerStream = isOpenAI
    ? streamOpenAI({
        model: model.id,
        messages: request.messages,
        tools: request.tools,
        systemPrompt: request.system_prompt,
        apiKey,
      })
    : streamAnthropic({
        model: model.id,
        messages: request.messages,
        thinking_budget: request.thinking_budget,
        tools: request.tools,
        systemPrompt: request.system_prompt,
        apiKey,
      })

  let content = ''
  let thinkingContent = ''
  let toolCalls: ToolUseBlock[] | undefined

  try {
    for await (const delta of providerStream) {
      if (signal?.aborted) break

      if (delta.startsWith(THINKING_PFX)) {
        const chunk = delta.slice(THINKING_PFX.length)
        thinkingContent += chunk
        handlers.onThinkingDelta?.(chunk)
      } else if (delta.startsWith(TOOL_PFX)) {
        toolCalls = JSON.parse(delta.slice(TOOL_PFX.length)) as ToolUseBlock[]
      } else {
        content += delta
        handlers.onDelta(delta)
      }
    }

    if (thinkingContent) handlers.onThinkingDone?.(thinkingContent)
    if (toolCalls?.length) handlers.onToolCalls?.(toolCalls)

    handlers.onDone({
      run_id,
      content,
      model_routed: model.id,
      provider: model.provider,
      policy_admitted: true,
      memory_written: false,
      latency_ms: Date.now() - started,
      tool_calls: toolCalls,
      stop_reason: toolCalls?.length ? 'tool_use' : 'end_turn',
    })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return
    handlers.onError(err instanceof Error ? err.message : 'provider_error')
  }
}

// Execute a built-in tool call directly (used by the Tauri agentic loop where /api/* routes don't exist).
export async function executeBuiltinToolDirect(
  toolName: string,
  input: Record<string, unknown>,
  keys: { serper?: string; openai?: string }
): Promise<string> {
  if (toolName === 'web_search') {
    const query = (input.query as string | undefined) ?? ''
    const results = await webSearch(query, keys.serper)
    return results.map((r) => `- [${r.title}](${r.url}): ${r.snippet}`).join('\n') || 'No results found.'
  }

  if (toolName === 'generate_image') {
    const prompt = (input.prompt as string | undefined) ?? ''
    if (!keys.openai) return 'Error: OpenAI API key required for image generation.'
    const img = await generateImage(prompt, keys.openai)
    const caption = img.revised_prompt ? `\n*${img.revised_prompt}*` : ''
    return `![Generated image](${img.url})${caption}`
  }

  return `Unknown built-in tool: ${toolName}`
}

export { isTauri }
