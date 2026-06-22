/**
 * provider-caps — capability DETECTION for linked vendor keys.
 *
 * "Use all their features or will it break?" — assuming parity breaks. A key authorizes some set of
 * models/features, not all. This probes the provider's /models endpoint with the key and derives a
 * feature matrix, so the router + UI expose ONLY what the key actually supports (vision, tools,
 * prompt-caching, pdf, image-gen, realtime, batch) instead of sending a request the key can't serve.
 */

export interface ProviderFeatures {
  vision: boolean; tools: boolean; streaming: boolean
  promptCaching: boolean; pdf: boolean; imageGen: boolean; realtime: boolean; batch: boolean
}
export interface ProviderCaps {
  provider: 'anthropic' | 'openai'
  ok: boolean
  models: string[]
  features: ProviderFeatures
  error?: string
}

const NONE: ProviderFeatures = { vision: false, tools: false, streaming: false, promptCaching: false, pdf: false, imageGen: false, realtime: false, batch: false }

export async function probeAnthropic(key: string): Promise<ProviderCaps> {
  const base: ProviderCaps = { provider: 'anthropic', ok: false, models: [], features: { ...NONE } }
  if (!key.trim()) return { ...base, error: 'no key' }
  try {
    const r = await fetch('https://api.anthropic.com/v1/models', {
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      signal: AbortSignal.timeout(8000),
    })
    if (!r.ok) return { ...base, error: `http ${r.status}` }
    const j = (await r.json()) as { data?: { id: string }[] }
    const models = (j.data ?? []).map((m) => m.id)
    const has = (re: RegExp) => models.some((m) => re.test(m))
    return {
      provider: 'anthropic', ok: true, models,
      features: {
        vision: has(/claude-3|claude-(sonnet|opus|haiku)/),       // Claude 3+ are all vision
        tools: true, streaming: true,
        promptCaching: has(/claude-3-5|sonnet-4|opus-4|haiku-4/),  // caching from 3.5 up
        pdf: has(/claude-3-5|sonnet-4|opus-4/),
        imageGen: false, realtime: false, batch: true,
      },
    }
  } catch { return { ...base, error: 'probe_failed' } }
}

export async function probeOpenAI(key: string): Promise<ProviderCaps> {
  const base: ProviderCaps = { provider: 'openai', ok: false, models: [], features: { ...NONE } }
  if (!key.trim()) return { ...base, error: 'no key' }
  try {
    const r = await fetch('https://api.openai.com/v1/models', {
      headers: { authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(8000),
    })
    if (!r.ok) return { ...base, error: `http ${r.status}` }
    const j = (await r.json()) as { data?: { id: string }[] }
    const models = (j.data ?? []).map((m) => m.id)
    const has = (re: RegExp) => models.some((m) => re.test(m))
    return {
      provider: 'openai', ok: true, models,
      features: {
        vision: has(/gpt-4o|gpt-4-turbo|gpt-4\.|o1|o3|gpt-5/),
        tools: true, streaming: true, promptCaching: false,
        pdf: false,
        imageGen: has(/dall-e|gpt-image/),
        realtime: has(/realtime/),
        batch: true,
      },
    }
  } catch { return { ...base, error: 'probe_failed' } }
}

export function probeProvider(provider: string, key: string): Promise<ProviderCaps> {
  return provider === 'openai' ? probeOpenAI(key) : probeAnthropic(key)
}
