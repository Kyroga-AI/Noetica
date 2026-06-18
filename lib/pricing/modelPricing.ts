// Provider pricing for cost estimation in the benchmark/governance dashboards.
//
// Prices are USD per 1,000,000 tokens (input / output), approximate published
// list prices as of 2026 — they exist to make the local-vs-cloud cost contrast
// concrete, not for billing. Local models run on the user's hardware: $0 marginal.
//
// Framework-agnostic (no 'use client', no React) so the agent-machine server and
// the Next.js client can both import it.

export interface TokenPrice {
  /** USD per 1M input tokens */
  input: number
  /** USD per 1M output tokens */
  output: number
}

// Keyed by exact model id where known.
const MODEL_PRICES: Record<string, TokenPrice> = {
  // Anthropic
  'claude-opus-4-8':          { input: 15,   output: 75 },
  'claude-sonnet-4-6':        { input: 3,    output: 15 },
  'claude-haiku-4-5-20251001':{ input: 1,    output: 5 },
  // OpenAI
  'gpt-4o':                   { input: 2.5,  output: 10 },
  'gpt-4o-mini':              { input: 0.15, output: 0.6 },
  'o3':                       { input: 2,    output: 8 },
}

// Provider-level fallback when the exact model id isn't in the table.
const PROVIDER_PRICES: Record<string, TokenPrice> = {
  anthropic: { input: 3,   output: 15 },
  openai:    { input: 2.5, output: 10 },
  google:    { input: 1.25, output: 5 },
  mistral:   { input: 2,   output: 6 },
}

// Providers that run on the user's own hardware — zero marginal cost, zero egress.
const LOCAL_PROVIDERS = new Set(['ollama', 'meta', 'local'])

export function isLocalProvider(provider: string | undefined): boolean {
  return !!provider && LOCAL_PROVIDERS.has(provider.toLowerCase())
}

export function priceFor(provider: string | undefined, model: string | undefined): TokenPrice {
  if (isLocalProvider(provider)) return { input: 0, output: 0 }
  if (model && MODEL_PRICES[model]) return MODEL_PRICES[model]!
  if (provider && PROVIDER_PRICES[provider.toLowerCase()]) return PROVIDER_PRICES[provider.toLowerCase()]!
  return { input: 0, output: 0 } // unknown provider — treat as free rather than invent a number
}

/** Estimated USD cost for a single run. Local providers are always $0. */
export function estimateCostUsd(opts: {
  provider?: string
  model?: string
  inputTokens?: number
  outputTokens?: number
}): number {
  const p = priceFor(opts.provider, opts.model)
  const inUsd = ((opts.inputTokens ?? 0) / 1_000_000) * p.input
  const outUsd = ((opts.outputTokens ?? 0) / 1_000_000) * p.output
  return inUsd + outUsd
}

/**
 * Tokens that left the user's device. For local providers this is 0 (full
 * sovereignty); for cloud providers the entire prompt + completion egresses.
 */
export function tokensEgressed(opts: {
  provider?: string
  inputTokens?: number
  outputTokens?: number
}): number {
  if (isLocalProvider(opts.provider)) return 0
  return (opts.inputTokens ?? 0) + (opts.outputTokens ?? 0)
}
