/**
 * prophet-cloud-mesh — the tiered escape hatch above the local model.
 *
 * Noetica is local-FIRST, not local-only. For the hard tail that a small local model can't reach
 * even inside the verify-repair loop, the mesh escalates to a SOVEREIGN-HOSTED open model (your
 * own infra — DeepSeek-V4-class, frontier-parity, data never touches a vendor) and, only if you
 * opt in, a vendor frontier model. The ladder is:
 *
 *     local (ollama)  →  sovereign (self-hosted, OpenAI-compatible)  →  frontier (vendor)
 *
 * Tiers above local are OFF until configured, so the default stays fully sovereign and offline.
 * Sovereign is configured by env (so it works headless / in cron too):
 *     NOETICA_SOVEREIGN_URL    e.g. https://mesh.your-org.internal/v1   (OpenAI-compatible base)
 *     NOETICA_SOVEREIGN_MODEL  e.g. deepseek-v4-pro
 *     NOETICA_SOVEREIGN_KEY    optional bearer token
 */

export interface SovereignConfig { url: string; model: string; key?: string }

/** Resolve the sovereign tier from env. Null = not configured (local-only, the default). */
export function sovereignConfig(env: Record<string, string | undefined> = process.env): SovereignConfig | null {
  const url = (env['NOETICA_SOVEREIGN_URL'] ?? '').trim()
  const model = (env['NOETICA_SOVEREIGN_MODEL'] ?? '').trim()
  if (!url || !model) return null
  const key = (env['NOETICA_SOVEREIGN_KEY'] ?? '').trim()
  return { url: url.replace(/\/+$/, ''), model, ...(key ? { key } : {}) }
}

export interface MeshTier { tier: 'local' | 'sovereign' | 'frontier'; label: string; available: boolean; model?: string; detail: string }

/** Inspectable ladder — what each tier is and whether it's armed right now. Backs /api/mesh/status. */
export function meshLadder(opts: { hasAnthropicKey?: boolean; env?: Record<string, string | undefined> } = {}): MeshTier[] {
  const sov = sovereignConfig(opts.env)
  return [
    { tier: 'local', label: 'Local', available: true, detail: 'ollama on-device — always on, fully offline, the default for everything.' },
    { tier: 'sovereign', label: 'Sovereign host', available: !!sov, ...(sov ? { model: sov.model } : {}), detail: sov ? `self-hosted ${sov.model} — frontier-parity, your infra, data stays sovereign.` : 'not configured — set NOETICA_SOVEREIGN_URL + NOETICA_SOVEREIGN_MODEL to arm.' },
    { tier: 'frontier', label: 'Vendor frontier', available: !!opts.hasAnthropicKey, detail: opts.hasAnthropicKey ? 'vendor model — opt-in, leaves the device; last resort for the hardest tail.' : 'no key — disarmed.' },
  ]
}

/**
 * Generate via the sovereign tier (OpenAI-compatible /chat/completions — what vLLM, TGI, SGLang,
 * llama.cpp-server and most open-model hosts expose). Returns null if the tier isn't configured or
 * the call fails, so callers degrade cleanly to local.
 */
export async function generateSovereign(opts: {
  messages: { role: string; content: string }[]
  temperature?: number
  maxTokens?: number
  timeoutMs?: number
  env?: Record<string, string | undefined>
}): Promise<{ content: string; model: string } | null> {
  const cfg = sovereignConfig(opts.env)
  if (!cfg) return null
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (cfg.key) headers['authorization'] = `Bearer ${cfg.key}`
  try {
    const r = await fetch(`${cfg.url}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model: cfg.model, messages: opts.messages, temperature: opts.temperature ?? 0.3, max_tokens: opts.maxTokens ?? 2048, stream: false }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 120_000),
    })
    if (!r.ok) return null
    const j = (await r.json()) as { choices?: { message?: { content?: string } }[] }
    const content = j.choices?.[0]?.message?.content
    return typeof content === 'string' && content.trim() ? { content, model: cfg.model } : null
  } catch {
    return null
  }
}
