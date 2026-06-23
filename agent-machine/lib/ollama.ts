/**
 * Ollama integration for the Noetica Agent Machine.
 *
 * Ollama exposes an OpenAI-compatible /v1/chat/completions endpoint so the
 * streaming logic is identical to the OpenAI path — just a different base URL
 * and no Authorization header required.
 */

import * as os from 'node:os'
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
// When the managed runtime pins the base, the health probe must NOT wander back to
// OLLAMA_PRIMARY — the bundled Ollama there answers /api/tags but can't generate, so
// an unpinned probe would re-select the broken backend. Pinning makes the app-owned
// runtime authoritative.
let _pinned = false

/** The Ollama base URL currently in use (may switch to the fallback after a failure). */
export function ollamaBase(): string { return _activeBase }
/** Repoint AND pin the active Ollama base (the boot managed-runtime owns the model plane). */
export function setOllamaBase(url: string): void { _activeBase = url; _pinned = true }
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
/** CPU inference (low-memory hosts) is much slower than Metal, especially on a
 *  cold load; the default 120s timeout cuts off legitimate generations. Allow a
 *  longer budget on low-memory hosts and an explicit override. */
export function chatTimeoutMs(): number {
  const env = Number(process.env['NOETICA_OLLAMA_TIMEOUT_MS'])
  if (env > 0) return env
  return isLowMemoryHost() ? 600_000 : 120_000
}

async function postChat(body: unknown, timeoutMs = chatTimeoutMs()): Promise<Response> {
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
  // Default short (a slow query-embed mustn't hang a chat turn — degrade to lexical). But under BATCH load
  // (the MMLU board: the GPU is saturated by generation, so nomic embeds queue), 8s-with-no-retry collapsed
  // every embed to [] and silently contaminated whole runs (lexical-only). So: env-tunable timeout + a
  // retry-on-timeout (transient GPU contention clears in a beat). The board sets NOETICA_EMBED_TIMEOUT_MS
  // high so embeds WAIT for the GPU instead of poisoning retrieval.
  const timeoutMs = Number(process.env['NOETICA_EMBED_TIMEOUT_MS'] || 8_000)
  const retries = Number(process.env['NOETICA_EMBED_RETRIES'] || 1)   // extra attempts per base on timeout
  for (let i = 0; i < bases.length; i++) {
    const base = bases[i]!
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const res = await fetch(`${base}/api/embeddings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: EMBED_MODEL, prompt: text.slice(0, 8000) }),
          signal: AbortSignal.timeout(timeoutMs),
        })
        if (res.ok) {
          const json = (await res.json()) as { embedding?: number[] }
          const vec = Array.isArray(json.embedding) ? json.embedding : []
          if (vec.length) { _activeBase = base; return vec }
          console.warn(`[ollama] embedText: ${base} returned ok but an empty embedding (model=${EMBED_MODEL}) — retrieval degrades to lexical-only`)
        } else {
          console.warn(`[ollama] embedText: ${base} returned ${res.status} (model=${EMBED_MODEL})`)
        }
        break                            // non-ok/empty (not a timeout) → don't retry this base; try the fallback
      } catch (e) {                      // timeout / network → retry the SAME base (the stall is transient)
        console.warn(`[ollama] embedText: ${base} request failed (${e instanceof Error ? e.message : String(e)})${attempt < retries ? ' — retrying' : ''}`)
        if (attempt < retries) await new Promise((r) => setTimeout(r, 300 * (attempt + 1)))
      }
    }
  }
  // A silent [] looks identical to "no fallback configured" — surface it so a broken embedder is
  // diagnosable instead of invisibly collapsing every STEM query to lexical-only.
  console.warn('[ollama] embedText: all bases failed — returning [] (lexical-only retrieval this turn)')
  return []
}

// Cosine similarity — re-exported from the canonical lib/vec-sim.js (kept here for existing
// `import { cosineSim } from './ollama.js'` callers). 0 if either vector is empty/zero.
export { cosineSim } from './vec-sim.js'

// ─── Health & model inventory ─────────────────────────────────────────────────

export async function isOllamaRunning(): Promise<boolean> {
  // Probe primary then fallback; pin the active base to the first that responds so
  // the preflight gate doesn't block when only the system Ollama is up. (Note: a
  // primary that lists models but can't generate still passes here — the
  // missing-runner fallback then kicks in inside postChat during streaming.)
  // Pinned (managed runtime active) → probe ONLY the pinned base, never wander to
  // the bundled Ollama on the primary port (it lists models but can't generate).
  const candidates = _pinned
    ? [_activeBase]
    : (HAS_FALLBACK ? [OLLAMA_PRIMARY, OLLAMA_FALLBACK] : [OLLAMA_PRIMARY])
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

  try {
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
  } finally {
    reader.releaseLock() // release the stream lock even if onProgress throws or read() rejects mid-stream
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
    model: await resolveChatModel(params.model),
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

// ─── Low-memory (small Apple Silicon) inference safety ──────────────────────
// On Apple Silicon the GPU shares system RAM. On 8GB-class boxes, offloading a
// model to Metal then allocating the KV/compute buffers exhausts GPU memory at
// decode time — the runner fails with kIOGPUCommandBufferCallbackErrorOutOfMemory
// and returns an empty zero-value response (the "0 out" empty-bubble bug). The
// fix that works through Ollama's OpenAI-compat /v1 endpoint (which ignores
// per-request num_gpu/num_ctx) is to pin the model to CPU at *load* time via a
// Modelfile-derived variant. We provision a `<model>-cpu` (num_gpu 0, capped
// num_ctx) lazily and route to it on small hosts.

const LOW_MEM_GB = Number(process.env['NOETICA_LOWMEM_THRESHOLD_GB'] ?? 10)
const CPU_NUM_CTX = Number(process.env['NOETICA_CPU_NUM_CTX'] ?? 4096)
const _cpuVariants = new Map<string, string>() // base model -> ensured variant

/** True on boxes where Metal offload is unsafe (≤ ~10GB unified memory).
 *  Override: NOETICA_FORCE_GPU=1 (never pin CPU), NOETICA_FORCE_CPU=1 (always). */
export function isLowMemoryHost(): boolean {
  if (process.env['NOETICA_FORCE_GPU'] === '1') return false
  if (process.env['NOETICA_FORCE_CPU'] === '1') return true
  return os.totalmem() / 1024 ** 3 <= LOW_MEM_GB
}

/** Ensure a CPU-pinned variant of `model` exists; return its name. Idempotent
 *  and best-effort: on any failure returns the original model so chat proceeds. */
export async function ensureCpuVariant(model: string): Promise<string> {
  if (model.endsWith('-cpu')) return model
  if (_cpuVariants.has(model)) return _cpuVariants.get(model)!
  const variant = `${model}-cpu`
  try {
    const res = await fetch(`${ollamaBase()}/api/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: variant, from: model, parameters: { num_gpu: 0, num_ctx: CPU_NUM_CTX } }),
      signal: AbortSignal.timeout(120_000),
    })
    if (!res.ok) return model
    await res.text() // drain the create status stream to completion
    _cpuVariants.set(model, variant)
    return variant
  } catch {
    return model
  }
}

/** The model the chat path should actually call: CPU-pinned on low-memory hosts.
 *  On low-memory hosts we ALWAYS return the `-cpu` name (the variants are
 *  pre-provisioned at runtime boot) and only fire the create in the background —
 *  never await it, so a slow/failed request-time create can't silently fall the
 *  chat back to the GPU base model (which then OOMs and returns empty). */
export async function resolveChatModel(model: string): Promise<string> {
  if (!isLowMemoryHost()) return model
  if (model.endsWith('-cpu')) return model
  const variant = `${model}-cpu`
  if (!_cpuVariants.has(model)) void ensureCpuVariant(model) // background, idempotent
  return variant
}

/** Pre-provision CPU variants for the given models (called at runtime boot on
 *  low-memory hosts so the request path never needs a create round-trip). */
export async function provisionCpuVariants(models: string[]): Promise<void> {
  if (!isLowMemoryHost()) return
  for (const m of models) { try { await ensureCpuVariant(m) } catch { /* best-effort */ } }
}

export async function* streamOllama(params: {
  model: string
  messages: OllamaMessage[]
  tools?: ProviderTool[]
  numCtx?: number
  temperature?: number
  maxTokens?: number
  keepAlive?: string
}): AsyncGenerator<ProviderEvent> {
  const options: Record<string, unknown> = {
    num_ctx: params.numCtx ?? 16384,
    temperature: params.temperature ?? 0.7,
  }
  // num_predict caps output tokens (Ollama's equivalent of max_tokens).
  if (params.maxTokens && params.maxTokens > 0) options['num_predict'] = params.maxTokens

  const model = await resolveChatModel(params.model)
  const body: Record<string, unknown> = {
    model,
    stream: true,
    messages: params.messages,
    options,
    // Keep the model resident between turns so the next query doesn't cold-load
    // (the default 5m unload is a frequent source of surprise multi-second stalls).
    keep_alive: params.keepAlive ?? '30m',
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
  // Track whether the model ever emitted a *visible* answer. Reasoning models
  // (deepseek-r1) can exhaust their generation budget inside chain-of-thought —
  // emitted via reasoning_content or unclosed <think> — and never produce any
  // `content`. Without recovery that renders as an empty bubble (the "0 out"
  // failure). We accumulate the reasoning so we can surface it as the answer.
  let emittedVisible = false
  let reasoningAccum = ''

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

  // Final flush + empty-answer recovery. If the model produced reasoning but no
  // visible content (budget exhausted inside chain-of-thought), surface the
  // reasoning as the answer rather than rendering an empty bubble.
  function* finalize(): Generator<{ type: 'text' | 'thinking'; text: string }> {
    for (const ev of flushText('')) {
      if (ev.type === 'text' && ev.text.trim()) emittedVisible = true
      else if (ev.type === 'thinking') reasoningAccum += ev.text
      yield ev
    }
    if (!emittedVisible && reasoningAccum.trim()) {
      yield { type: 'text', text: reasoningAccum.trim() }
      emittedVisible = true
    }
  }

  try {
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
        // Flush remaining buffered text + recover an empty answer if needed.
        yield* finalize()
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
        reasoningAccum += reasoningChunk
        yield { type: 'thinking', text: reasoningChunk }
      }
      if (delta?.content) {
        for (const ev of flushText(delta.content)) {
          if (ev.type === 'text' && ev.text.trim()) emittedVisible = true
          else if (ev.type === 'thinking') reasoningAccum += ev.text
          yield ev
        }
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
  // Stream ended without a [DONE] marker (reader closed): finalize here too so a
  // reasoning-only response is still recovered instead of vanishing.
  yield* finalize()
  } finally {
    reader.releaseLock() // covers normal end, the [DONE] early-return, a throw, and consumer early-break
  }
}
