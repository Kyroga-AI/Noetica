/**
 * Ollama integration for the Noetica Agent Machine.
 *
 * Ollama exposes an OpenAI-compatible /v1/chat/completions endpoint so the
 * streaming logic is identical to the OpenAI path — just a different base URL
 * and no Authorization header required.
 */

import type { ProviderTool, ToolUseBlock, ProviderEvent } from '../server.js'

// 11435 is Noetica's isolated Ollama port — separate from any system Ollama on 11434.
// OLLAMA_HOST env can override for dev (e.g. point at system Ollama during local iteration).
export const OLLAMA_BASE = process.env['OLLAMA_HOST'] ?? 'http://127.0.0.1:11435'

// ─── Health & model inventory ─────────────────────────────────────────────────

export async function isOllamaRunning(): Promise<boolean> {
  try {
    const res = await fetch(`${OLLAMA_BASE}/api/tags`, {
      signal: AbortSignal.timeout(2_000),
    })
    return res.ok
  } catch {
    return false
  }
}

export async function listLocalModels(): Promise<string[]> {
  try {
    const res = await fetch(`${OLLAMA_BASE}/api/tags`, {
      signal: AbortSignal.timeout(3_000),
    })
    if (!res.ok) return []
    const json = (await res.json()) as { models?: Array<{ name: string }> }
    return json.models?.map((m) => m.name) ?? []
  } catch {
    return []
  }
}

// Pull a model and stream progress back via a callback.
export async function pullModel(
  model: string,
  onProgress: (status: string, pct: number | null) => void,
): Promise<void> {
  const res = await fetch(`${OLLAMA_BASE}/api/pull`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: model, stream: true }),
    signal: AbortSignal.timeout(30 * 60 * 1_000), // 30 min
  })
  if (!res.ok || !res.body) throw new Error(`Ollama pull failed: ${res.status}`)

  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    const lines = buf.split('\n')
    buf = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const p = JSON.parse(line) as {
          status?: string
          completed?: number
          total?: number
        }
        const pct =
          p.completed && p.total ? Math.round((p.completed / p.total) * 100) : null
        onProgress(p.status ?? '', pct)
      } catch { /* ignore parse errors */ }
    }
  }
}

// ─── Streaming completions ────────────────────────────────────────────────────

type OllamaMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: OAIToolCall[] }
  | { role: 'tool'; content: string; tool_call_id: string }

interface OAIToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export async function* streamOllama(params: {
  model: string
  messages: OllamaMessage[]
  tools?: ProviderTool[]
}): AsyncGenerator<ProviderEvent> {
  const body: Record<string, unknown> = {
    model: params.model,
    stream: true,
    messages: params.messages,
    options: {
      num_ctx: 16384,
      temperature: 0.7,
    },
  }

  if (params.tools?.length) {
    body['tools'] = params.tools.map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.input_schema,
      },
    }))
    body['tool_choice'] = 'auto'
  }

  const res = await fetch(`${OLLAMA_BASE}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  })

  if (!res.ok) {
    const detail = await res.text()
    throw new Error(`Ollama ${res.status}: ${detail}`)
  }
  if (!res.body) throw new Error('Ollama response body was empty.')

  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = ''

  type PartialCall = { id: string; name: string; argsJson: string }
  const toolCallMap = new Map<number, PartialCall>()

  // DeepSeek R1 and other reasoning models emit <think>...</think> blocks.
  // Buffer the accumulated text to detect and route them as thinking events.
  let textAccum = ''
  let inThink = false

  function flushText(chunk: string): Array<{ type: 'text' | 'thinking'; text: string }> {
    const events: Array<{ type: 'text' | 'thinking'; text: string }> = []
    textAccum += chunk
    while (true) {
      if (!inThink) {
        const open = textAccum.indexOf('<think>')
        if (open === -1) {
          // No think block — emit everything as text
          if (textAccum) { events.push({ type: 'text', text: textAccum }); textAccum = '' }
          break
        }
        // Emit text before <think>
        if (open > 0) events.push({ type: 'text', text: textAccum.slice(0, open) })
        textAccum = textAccum.slice(open + 7)
        inThink = true
      } else {
        const close = textAccum.indexOf('</think>')
        if (close === -1) {
          // Still inside think block — emit as thinking
          if (textAccum) { events.push({ type: 'thinking', text: textAccum }); textAccum = '' }
          break
        }
        // Emit thinking content up to </think>
        if (close > 0) events.push({ type: 'thinking', text: textAccum.slice(0, close) })
        textAccum = textAccum.slice(close + 8)
        inThink = false
      }
    }
    return events
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buf += dec.decode(value, { stream: true })
    const lines = buf.split('\n')
    buf = lines.pop() ?? ''

    for (const line of lines) {
      if (!line.startsWith('data:')) continue
      const raw = line.slice(5).trim()
      if (raw === '[DONE]') {
        // Flush remaining buffered text
        for (const ev of flushText('')) yield ev
        if (toolCallMap.size) {
          const calls: ToolUseBlock[] = Array.from(toolCallMap.entries())
            .sort(([a], [b]) => a - b)
            .map(([, tc]) => ({
              id: tc.id,
              name: tc.name,
              input: (() => {
                try { return JSON.parse(tc.argsJson) as Record<string, unknown> }
                catch { return {} }
              })(),
            }))
          yield { type: 'tool_calls', calls }
        }
        return
      }
      if (!raw) continue

      const p = JSON.parse(raw) as {
        choices?: Array<{
          delta?: {
            content?: string
            tool_calls?: Array<{
              index: number
              id?: string
              function?: { name?: string; arguments?: string }
            }>
          }
        }>
      }

      const delta = p.choices?.[0]?.delta
      if (delta?.content) {
        for (const ev of flushText(delta.content)) yield ev
      }

      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          const ex = toolCallMap.get(tc.index)
          if (!ex) {
            toolCallMap.set(tc.index, {
              id: tc.id ?? `tc-${tc.index}`,
              name: tc.function?.name ?? '',
              argsJson: tc.function?.arguments ?? '',
            })
          } else {
            if (tc.id) ex.id = tc.id
            if (tc.function?.name) ex.name += tc.function.name
            if (tc.function?.arguments) ex.argsJson += tc.function.arguments
          }
        }
      }
    }
  }
}
