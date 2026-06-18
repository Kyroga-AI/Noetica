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
const OLLAMA_PRIMARY = process.env['OLLAMA_HOST'] ?? 'http://127.0.0.1:11435'
// The primary is the app's OWN managed runtime (provisioned complete + sandboxed).
// We no longer IMPLICITLY fall back to the user's system Ollama — that reintroduces
// the host dependency the Agent Machine exists to remove. A fallback is used ONLY
// when explicitly configured (OLLAMA_FALLBACK_HOST), e.g. dev or a deliberate HA
// peer. Empty ⇒ no fallback (errors surface clearly instead of silently using a
// host install). The bundled-runner freeze is now fixed at the provisioning layer.
const OLLAMA_FALLBACK = process.env['OLLAMA_FALLBACK_HOST'] ?? ''
const HAS_FALLBACK = OLLAMA_FALLBACK !== '' && OLLAMA_FALLBACK !== OLLAMA_PRIMARY
let _activeBase = OLLAMA_PRIMARY

/** The Ollama base URL currently in use (may switch to the fallback after a failure). */
export function ollamaBase(): string { return _activeBase }
// Back-compat for existing imports; prefer ollamaBase() for the live value.
export const OLLAMA_BASE = OLLAMA_PRIMARY

// A 5xx whose body names the missing inference runner means "can list models but
// cannot generate" — exactly the bundled-Ollama-missing-llama-server failure.
export function isRunnerMissing(status: number, body: string): boolean {
  return status >= 500 && /llama-server|no runner|runner.*not found|binary not found/i.test(body)
}
function isUnreachable(err: unknown): boolean {
  const cause = (err as { cause?: { code?: string } })?.cause?.code
  return cause === 'ECONNREFUSED' || (err instanceof Error && /fetch failed|ECONNREFUSED/i.test(err.message))
}

/**
 * POST to /v1/chat/completions against the active Ollama, with a one-time automatic
 * fallback to the system Ollama if the active backend is unreachable or can't run
 * inference. Returns an OK Response (caller streams/reads it) or throws a clear,
 * actionable error. On a successful fallback the active base sticks for the session.
 */
async function postChat(body: unknown, timeoutMs = 120_000): Promise<Response> {
  const bases = (_activeBase === OLLAMA_PRIMARY && HAS_FALLBACK)
    ? [OLLAMA_PRIMARY, OLLAMA_FALLBACK]
    : [_activeBase]
  for (let i = 0; i < bases.length; i++) {
    const base = bases[i]!
    const isLast = i === bases.length - 1
    try {
      const res = await fetch(`${base}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (res.ok) { _activeBase = base; return res }
      const detail = await res.text()
      if (!isLast && isRunnerMissing(res.status, detail)) {
        console.warn(`[ollama] ${base} can't run inference (${res.status}: runner missing) — falling back to ${bases[i + 1]}`)
        continue
      }
      _activeBase = base
      if (isRunnerMissing(res.status, detail)) {
        throw new Error(`Ollama at ${base} is missing its inference runner (llama-server). Reinstall the app or run a system \`ollama serve\`.`)
      }
      throw new Error(`Ollama ${res.status}: ${detail}`)
    } catch (err) {
      if (!isLast && isUnreachable(err)) {
        console.warn(`[ollama] ${base} unreachable — falling back to ${bases[i + 1]}`)
        continue
      }
      if (isUnreachable(err)) {
        throw new Error(`Ollama is not reachable at ${base}. Start it with \`ollama serve\` or switch to a cloud provider.`)
      }
      if (err instanceof Error && err.name === 'TimeoutError') {
        throw new Error(`Ollama timed out after ${Math.round(timeoutMs / 1000)}s at ${base} — the model may be loading. Try again or use a cloud provider.`)
      }
      throw err
    }
  }
  throw new Error('Ollama request failed against all configured hosts')
}

// ─── Embeddings (semantic retrieval) ───────────────────────────────────────────

/** Embedding model for document/chunk vectors. nomic-embed-text → 768-dim. */
export const EMBED_MODEL = process.env['NOETICA_EMBED_MODEL'] ?? 'nomic-embed-text'

/**
 * Embed text → vector via Ollama. Returns [] on failure so callers degrade to
 * lexical retrieval rather than throwing. Uses the active Ollama base.
 */
export async function embedText(text: string): Promise<number[]> {
  // Same primary→fallback resilience as chat: at ingest time the active base may
  // still be a broken bundled Ollama (lists models, can't run the model), so try
  // the fallback before giving up — otherwise embeddings silently fail and
  // retrieval degrades to lexical-only.
  const bases = (_activeBase === OLLAMA_PRIMARY && HAS_FALLBACK)
    ? [OLLAMA_PRIMARY, OLLAMA_FALLBACK]
    : [_activeBase]
  for (let i = 0; i < bases.length; i++) {
    const base = bases[i]!
    try {
      const res = await fetch(`${base}/api/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: EMBED_MODEL, prompt: text.slice(0, 8000) }),
        // Keep this short: a slow query-embedding must not block retrieval — it
        // falls back to lexical search instead of hanging the whole chat turn.
        signal: AbortSignal.timeout(8_000),
      })
      if (res.ok) {
        const json = (await res.json()) as { embedding?: number[] }
        const vec = Array.isArray(json.embedding) ? json.embedding : []
        if (vec.length) { _activeBase = base; return vec }
      }
      // non-ok or empty → try fallback if any
    } catch { /* try fallback */ }
  }
  return []
}

/** Cosine similarity of two equal-length vectors. 0 if either is empty/zero. */
export function cosineSim(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length)
  if (n === 0) return 0
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < n; i++) { dot += a[i]! * b[i]!; na += a[i]! * a[i]!; nb += b[i]! * b[i]! }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

// ─── Health & model inventory ─────────────────────────────────────────────────

export async function isOllamaRunning(): Promise<boolean> {
  // Probe primary then fallback; pin the active base to the first that responds so
  // the preflight gate doesn't block when only the system Ollama is up. (Note: a
  // primary that lists models but can't generate still passes here — the
  // missing-runner fallback then kicks in inside postChat during streaming.)
  const candidates = HAS_FALLBACK ? [OLLAMA_PRIMARY, OLLAMA_FALLBACK] : [OLLAMA_PRIMARY]
  for (const base of candidates) {
    try {
      const res = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(2_000) })
      if (res.ok) { _activeBase = base; return true }
    } catch { /* try next candidate */ }
  }
  return false
}

// Last-known-good model inventory. A transient empty/partial /api/tags response
// (Ollama slow, mid-load, or just restarted) must NOT make the router think a
// model vanished — that's what silently downgraded substantive questions to the
// tiny fallback. Serve the cache on any non-positive result.
let _modelInventory: string[] = []

export async function listLocalModels(): Promise<string[]> {
  try {
    const res = await fetch(`${ollamaBase()}/api/tags`, {
      signal: AbortSignal.timeout(3_000),
    })
    if (!res.ok) return _modelInventory
    const json = (await res.json()) as { models?: Array<{ name: string }> }
    const models = json.models?.map((m) => m.name) ?? []
    if (models.length > 0) _modelInventory = models // only refresh cache on a real list
    return models.length > 0 ? models : _modelInventory
  } catch {
    return _modelInventory
  }
}

// Per-model context length, read live from Ollama's /api/show and cached.
// Without this we'd hardcode a one-size num_ctx — too small for modern local
// models (qwen2.5/deepseek-r1 ship 32k–128k) and wasteful for tiny ones.
const _ctxCache = new Map<string, number>()

export async function getModelContextLength(model: string): Promise<number | null> {
  if (_ctxCache.has(model)) return _ctxCache.get(model)!
  try {
    const res = await fetch(`${ollamaBase()}/api/show`, {
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
  const res = await fetch(`${ollamaBase()}/api/pull`, {
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

// Non-streaming single completion — used by the 4D/RCS deliberation loop to
// generate candidate answers cheaply and judge them before selecting one.
export async function generateOllamaText(params: {
  model: string
  messages: Array<{ role: string; content: string | null | unknown[] }>
  temperature?: number
  numCtx?: number
}): Promise<{ content: string; reasoning: string }> {
  const res = await postChat({
    model: params.model,
    stream: false,
    messages: params.messages,
    options: { num_ctx: params.numCtx ?? 8192, temperature: params.temperature ?? 0.7 },
  })
  const data = await res.json() as {
    choices?: Array<{ message?: { content?: string; reasoning?: string; reasoning_content?: string } }>
  }
  const msg = data.choices?.[0]?.message
  return { content: msg?.content ?? '', reasoning: msg?.reasoning ?? msg?.reasoning_content ?? '' }
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

  // postChat handles unreachable / missing-runner fallback to the system Ollama and
  // surfaces a clear, actionable error otherwise. Returns an OK response.
  const res = await postChat(body)
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
