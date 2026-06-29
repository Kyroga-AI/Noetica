/**
 * AgentSession — the base session abstraction for the Noetica Agent Machine.
 *
 * Provides a provider-injected `respond` method so subclasses (e.g. LabSession)
 * can fall back to the model without importing server internals.
 */

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

// ─── Policy / schema types (used by router integrations) ─────────────────────

export interface Reasoning {
  mode: 'none' | 'chain-of-thought' | 'scratchpad'
  maxTokens?: number
}

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

// ─── SessionConfig ────────────────────────────────────────────────────────────

export interface SessionConfig {
  /** Inject a provider (useful in tests and for subclasses that specialise routing). */
  _provider?: SessionProvider
  /** System prompt to prepend to every request. */
  systemPrompt?: string
  /** Model identifier override. */
  model?: string
  /** Max tokens for responses. */
  maxTokens?: number
  /** Temperature override. */
  temperature?: number
}

// ─── AgentSession ─────────────────────────────────────────────────────────────

/**
 * Base session class. Holds a SessionProvider and exposes `respond(prompt)`
 * so subclasses can call the model without depending on server internals.
 */
export class AgentSession {
  protected readonly _provider: SessionProvider | undefined
  protected readonly _systemPrompt: string | undefined
  protected readonly _model: string | undefined
  protected readonly _maxTokens: number | undefined
  protected readonly _temperature: number | undefined

  constructor(config: SessionConfig = {}) {
    this._provider = config._provider
    this._systemPrompt = config.systemPrompt
    this._model = config.model
    this._maxTokens = config.maxTokens
    this._temperature = config.temperature
  }

  /**
   * Call the provider with a single user prompt and return the text response.
   * Throws if no provider is configured.
   */
  async respond(prompt: string): Promise<string> {
    if (!this._provider) {
      throw new Error('AgentSession: no provider configured — pass _provider in SessionConfig')
    }

    const messages: SessionMessage[] = []
    if (this._systemPrompt) {
      messages.push({ role: 'system', content: this._systemPrompt })
    }
    messages.push({ role: 'user', content: prompt })

    const result = await this._provider.generate({
      messages,
      maxTokens: this._maxTokens,
      temperature: this._temperature,
    })

    return result.content
  }

  /**
   * Stream a response for a single user prompt.
   */
  async *stream(prompt: string): AsyncGenerator<StreamChunk> {
    if (!this._provider) {
      throw new Error('AgentSession: no provider configured — pass _provider in SessionConfig')
    }

    const messages: SessionMessage[] = []
    if (this._systemPrompt) {
      messages.push({ role: 'system', content: this._systemPrompt })
    }
    messages.push({ role: 'user', content: prompt })

    yield* this._provider.stream({
      messages,
      maxTokens: this._maxTokens,
      temperature: this._temperature,
    })
  }
}
