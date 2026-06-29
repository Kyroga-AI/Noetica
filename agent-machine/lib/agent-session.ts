/**
 * AgentSession — the base session abstraction for the Noetica Agent Machine.
 *
 * Architecture: AgentSession holds a SessionProvider (explicit or derived from
 * ReasoningLevel) and exposes respond()/stream() so subclasses (LabSession)
 * can call the model without depending on server internals.
 *
 * Reasoning mirrors Apple Foundation Models' .light/.moderate/.deep quality
 * levels. OllamaProvider implements SessionProvider with reasoning-level routing,
 * structured-output support (json_schema responseFormat), and transparent
 * Anthropic fallback on DEEP when ANTHROPIC_API_KEY is set.
 *
 * Environment (OllamaProvider):
 *   PROPHET_LIGHT_MODEL     local model for LIGHT      (default llama3.2:1b)
 *   PROPHET_MODERATE_MODEL  local model for MODERATE   (default qwen3:14b)
 *   PROPHET_DEEP_MODEL      local model for DEEP       (default qwen3:14b)
 *   ANTHROPIC_API_KEY       enables hosted fallback on DEEP
 *   PROPHET_HOSTED_MODEL    Anthropic model for DEEP fallback (default claude-sonnet-4-6)
 */
import { generateOllamaText, streamOllama } from './ollama.js'
import { createAttestation, verifyAttestation } from './device-attestation.js'
import { gateSovereignLane } from './content-safeguard.js'

// ── Reasoning — quality-speed tradeoff levels ─────────────────────────────────

/** Quality-speed tradeoff levels. Maps 1:1 to Apple FM's .light/.moderate/.deep. */
export enum Reasoning {
  LIGHT     = 'light',     // fastest local model (llama3.2:1b), best for classification
  MODERATE  = 'moderate',  // default balanced lane (qwen3:14b)
  DEEP      = 'deep',      // highest quality: local → Anthropic fallback when key set
  SOVEREIGN = 'sovereign', // local-only, zero egress (no fallback even with a key)
}

/** @deprecated Use Reasoning. Const+type merge so it works as both value and type. */
export const ReasoningLevel = Reasoning
export type ReasoningLevel = Reasoning

// ── OllamaProvider ────────────────────────────────────────────────────────────

const LEVEL_MODEL_ENV: Record<Reasoning, string> = {
  [Reasoning.LIGHT]:     'PROPHET_LIGHT_MODEL',
  [Reasoning.MODERATE]:  'PROPHET_MODERATE_MODEL',
  [Reasoning.DEEP]:      'PROPHET_DEEP_MODEL',
  [Reasoning.SOVEREIGN]: 'PROPHET_MODERATE_MODEL',
}
const LEVEL_MODEL_DEFAULT: Record<Reasoning, string> = {
  [Reasoning.LIGHT]:     'qwen3:4b',   // ~3-4B validated as on-device sweet spot (Apple AFM); 1B is too weak
  [Reasoning.MODERATE]:  'qwen3:14b',
  [Reasoning.DEEP]:      'qwen3:14b',
  [Reasoning.SOVEREIGN]: 'qwen3:14b',
}
const LEVEL_MAX_TOKENS: Record<Reasoning, number> = {
  [Reasoning.LIGHT]:     512,
  [Reasoning.MODERATE]:  2048,
  [Reasoning.DEEP]:      4096,
  [Reasoning.SOVEREIGN]: 2048,
}

function resolveModel(level: Reasoning): string {
  return process.env[LEVEL_MODEL_ENV[level]] ?? LEVEL_MODEL_DEFAULT[level]
}

async function anthropicFallback(params: {
  prompt: string; system?: string; schema?: StructuredSchema; maxTokens: number
}): Promise<string> {
  const key = process.env['ANTHROPIC_API_KEY']
  if (!key) throw new Error('ANTHROPIC_API_KEY not set — cannot fall back to hosted provider')
  const systemParts: string[] = []
  if (params.system) systemParts.push(params.system)
  if (params.schema) systemParts.push(
    `Respond with valid JSON conforming to:\n${JSON.stringify(params.schema, null, 2)}\nOutput only the JSON object.`
  )
  const body: Record<string, unknown> = {
    model: process.env['PROPHET_HOSTED_MODEL'] ?? 'claude-sonnet-4-6',
    max_tokens: params.maxTokens,
    messages: [{ role: 'user', content: params.prompt }],
  }
  if (systemParts.length) body['system'] = systemParts.join('\n\n')
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'anthropic-version': '2023-06-01',
      'x-api-key': key,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  })
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`)
  return ((await res.json() as { content?: Array<{ text?: string }> }).content?.[0]?.text) ?? ''
}

/** JSON Schema accepted by OllamaProvider.generate({ schema }) for structured output. */
export type StructuredSchema = {
  type: 'object'
  properties: Record<string, unknown>
  required?: string[]
  [key: string]: unknown
}

/**
 * Concrete SessionProvider: routes to the right local model by Reasoning level,
 * supports structured output (json_schema responseFormat), and falls back to
 * Anthropic on DEEP when the local provider fails and ANTHROPIC_API_KEY is set.
 */
export class OllamaProvider implements SessionProvider {
  private readonly level: Reasoning

  constructor(level: Reasoning = Reasoning.MODERATE) {
    this.level = level
  }

  async generate(params: GenerateParams & { schema?: StructuredSchema }): Promise<GenerateResult> {
    const model = resolveModel(this.level)
    const responseFormat = params.schema
      ? { type: 'json_schema' as const, json_schema: { name: 'response', schema: params.schema as Record<string, unknown>, strict: true } }
      : undefined
    const ollamaMessages = params.messages as Array<{ role: string; content: string | null | unknown[] }>

    if (this.level === Reasoning.DEEP) {
      try {
        return await generateOllamaText({ model, messages: ollamaMessages, responseFormat })
      } catch {
        const sysMsg = params.messages.find((m: SessionMessage) => m.role === 'system')?.content
        const reversed = [...params.messages].reverse()
        const userMsg = reversed.find((m: SessionMessage) => m.role === 'user')?.content ?? ''
        const text = await anthropicFallback({
          prompt: typeof userMsg === 'string' ? userMsg : JSON.stringify(userMsg),
          system: typeof sysMsg === 'string' ? sysMsg : undefined,
          schema: params.schema,
          maxTokens: LEVEL_MAX_TOKENS[this.level],
        })
        return { content: text, reasoning: '' }
      }
    }

    return generateOllamaText({ model, messages: ollamaMessages, responseFormat })
  }

  async *stream(params: GenerateParams): AsyncGenerator<StreamChunk> {
    const model = resolveModel(this.level)
    for await (const ev of streamOllama({
      model,
      messages: params.messages as Parameters<typeof streamOllama>[0]['messages'],
      enableThinking: false,
    })) {
      if ('text' in ev && typeof ev.text === 'string') yield { text: ev.text }
    }
  }

  static parseStructured(raw: string): Record<string, unknown> {
    const stripped = raw.replace(/^```(?:json)?\s*/m, '').replace(/```\s*$/m, '').trim()
    return JSON.parse(stripped) as Record<string, unknown>
  }
}

// ─── Message & Provider types ─────────────────────────────────────────────────

export interface SessionMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface GenerateParams {
  messages: SessionMessage[]
  maxTokens?: number
  temperature?: number
}

export interface GenerateResult {
  content: string
  reasoning: string
}

export interface StreamChunk {
  text?: string
  thinking?: string
  done?: boolean
}

/** The provider interface — an object that wraps an underlying LLM. */
export interface SessionProvider {
  generate(params: GenerateParams): Promise<GenerateResult>
  stream(params: GenerateParams): AsyncGenerator<StreamChunk>
}

// ─── Policy / schema types ─────────────────────────────────────────────────────

export type RoutePolicy =
  | 'local-only'
  | 'cloud-preferred'
  | 'sovereign'
  | 'auto'

export interface OutputSchema {
  type: 'json_schema'
  json_schema: {
    name: string
    schema: Record<string, unknown>
    strict?: boolean
  }
}

// ─── SessionConfig ─────────────────────────────────────────────────────────────

export interface SessionConfig {
  /** Explicit provider — takes precedence over `reasoning`. */
  _provider?: SessionProvider
  /** Reasoning level — creates an OllamaProvider internally when set. */
  reasoning?: Reasoning
  /** System prompt. Alias: systemPrompt. */
  system?: string
  /** @deprecated Use `system` */
  systemPrompt?: string
  model?: string
  maxTokens?: number
  temperature?: number
}

// ─── AgentSession ─────────────────────────────────────────────────────────────

export class AgentSession {
  protected readonly _provider: SessionProvider | undefined
  protected readonly _reasoning: Reasoning | undefined
  protected readonly _systemPrompt: string | undefined
  protected readonly _model: string | undefined
  protected readonly _maxTokens: number | undefined
  protected readonly _temperature: number | undefined

  constructor(config: SessionConfig = {}) {
    this._systemPrompt = config.system ?? config.systemPrompt
    this._model = config.model
    this._maxTokens = config.maxTokens
    this._temperature = config.temperature
    this._reasoning = config.reasoning
    if (config._provider) {
      this._provider = config._provider
    } else if (config.reasoning !== undefined) {
      this._provider = new OllamaProvider(config.reasoning)
    }
  }

  async respond(prompt: string, opts?: { schema?: OutputSchema }): Promise<string | Record<string, unknown>> {
    if (!this._provider) {
      throw new Error('AgentSession: no provider configured — pass reasoning or _provider in SessionConfig')
    }
    if (this._reasoning === Reasoning.SOVEREIGN) {
      const att = createAttestation()
      const result = verifyAttestation(att)
      if (!result.valid) {
        throw new Error(`SOVEREIGN: device attestation failed: ${result.reason}`)
      }
      // Uncensored ≠ ungoverned: even the attested sovereign lane enforces the prohibited legal floor.
      const gate = gateSovereignLane(prompt)
      if (!gate.allowed) {
        throw new Error(`SOVEREIGN: ${gate.reason}`)
      }
    }
    const messages: SessionMessage[] = []
    if (this._systemPrompt) messages.push({ role: 'system', content: this._systemPrompt })
    messages.push({ role: 'user', content: prompt })
    const structuredSchema = opts?.schema ? {
      type: 'object' as const,
      properties: (opts.schema.json_schema.schema['properties'] as Record<string, unknown>) ?? {},
      ...opts.schema.json_schema.schema,
    } as StructuredSchema : undefined
    const result = await (this._provider as OllamaProvider & SessionProvider).generate({
      messages, maxTokens: this._maxTokens, temperature: this._temperature, schema: structuredSchema,
    })
    if (structuredSchema) {
      try { return OllamaProvider.parseStructured(result.content) } catch { return result.content }
    }
    return result.content
  }

  async *stream(prompt: string): AsyncGenerator<StreamChunk> {
    if (!this._provider) {
      throw new Error('AgentSession: no provider configured — pass reasoning or _provider in SessionConfig')
    }
    const messages: SessionMessage[] = []
    if (this._systemPrompt) messages.push({ role: 'system', content: this._systemPrompt })
    messages.push({ role: 'user', content: prompt })
    yield* this._provider.stream({ messages, maxTokens: this._maxTokens, temperature: this._temperature })
  }
}
