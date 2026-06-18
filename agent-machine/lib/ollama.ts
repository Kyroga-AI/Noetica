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

// Per-model context length, read live from Ollama's /api/show and cached.
// Without this we'd hardcode a one-size num_ctx — too small for modern local
// models (qwen2.5/deepseek-r1 ship 32k–128k) and wasteful for tiny ones.
const _ctxCache = new Map<string, number>()

export async function getModelContextLength(model: string): Promise<number | null> {
  if (_ctxCache.has(model)) return _ctxCache.get(model)!
  try {
    const res = await fetch(`${OLLAMA_BASE}/api/show`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: model }),
      signal: AbortSignal.timeout(3_000),
    })
    if (!res.ok) return null
    const json = (await res.json()) as { model_info?: Record<string, unknown> }
    const info = json.model_info ?? {}
    // The key is architecture-prefixed, e.g. "qwen2.context_length", "llama.context_length"
    const key = Object.keys(info).find((k) => k.endsWith('.context_length'))
    const ctx = key ? Number(info[key]) : NaN
    if (!isNaN(ctx) && ctx > 0) {
      _ctxCache.set(model, ctx)
      return ctx
    }
    return null
  } catch {
    return null
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

// Vision/multi-part content uses the OpenAI-compat array shape; plain turns use a string.
type OllamaContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

type OllamaMessage =
  | { role: 'system'; content: string | OllamaContentPart[] }
  | { role: 'user'; content: string | OllamaContentPart[] }
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
  numCtx?: number
  temperature?: number
  maxTokens?: number
}): AsyncGenerator<ProviderEvent> {
  const options: Record<string, unknown> = {
    num_ctx: params.numCtx ?? 16384,
    temperature: params.temperature ?? 0.7,
  }
  // num_predict caps output tokens (Ollama's equivalent of max_tokens).
  if (params.maxTokens && params.maxTokens > 0) options['num_predict'] = params.maxTokens

  const body: Record<string, unknown> = {
    model: params.model,
    stream: true,
    messages: params.messages,
    options,
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

  let res: Response
  try {
    res = await fetch(`${OLLAMA_BASE}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    })
  } catch (err) {
    // Most common demo failure: Ollama isn't running. Surface a clear, actionable error
    // (the raw "fetch failed" / ECONNREFUSED is opaque to the user).
    const cause = (err as { cause?: { code?: string } })?.cause?.code
    if (cause === 'ECONNREFUSED' || (err instanceof Error && /fetch failed|ECONNREFUSED/i.test(err.message))) {
      throw new Error(`Ollama is not reachable at ${OLLAMA_BASE}. Start it with \`ollama serve\` or switch to a cloud provider.`)
    }
    if (err instanceof Error && err.name === 'TimeoutError') {
      throw new Error(`Ollama timed out after 120s at ${OLLAMA_BASE} — the model may be loading. Try again or use a cloud provider.`)
    }
    throw err
  }

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

      let p: {
        choices?: Array<{
          delta?: {
            content?: string
            // DeepSeek-R1 (and other reasoning models) emit chain-of-thought in a
            // dedicated field over Ollama's OpenAI-compat endpoint — NOT inline
            // <think> tags. Capture both so reasoning is never silently dropped.
            reasoning?: string
            reasoning_content?: string
            tool_calls?: Array<{
              index: number
              id?: string
              function?: { name?: string; arguments?: string }
            }>
          }
        }>
      }
      try {
        p = JSON.parse(raw)
      } catch {
        continue  // skip malformed SSE line — never crash the stream on a partial chunk
      }

      const delta = p.choices?.[0]?.delta
      // Native reasoning field → thinking event (deepseek-r1 via Ollama).
      const reasoningChunk = delta?.reasoning ?? delta?.reasoning_content
      if (reasoningChunk) {
        yield { type: 'thinking', text: reasoningChunk }
      }
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
