const SAE_PATCH_URL = process.env.SAE_PATCH_URL ?? 'http://127.0.0.1:8138'

export interface SaeHealthResponse {
  available: boolean
  model_loaded: boolean
  sae_loaded: boolean
  model_id: string
  sae_release: string
  sae_id: string
  hook_name: string
  device: string
  load_error: string | null
  import_errors: string[] | null
  cuda_available: boolean
}

export interface SaeSteerResponse {
  ok: boolean
  steered_completion: string
  original_feature_activation: number
  feature_id: number
  strength: number
  hook: string
  resid_delta_norm: number
}

export interface SaeActivateResponse {
  top_features: { feature_id: number; activation: number }[]
  hook: string
  prompt_tokens: number
}

export interface SaeCausalTriadArm {
  steered_completion?: string
  original_feature_activation?: number
  feature_id?: number
  strength?: number
  hook?: string
  resid_delta_norm?: number
  error?: string
}

export interface SaeCausalTriadResponse {
  ok: boolean
  schema_version: string
  feature_id: number
  hook: string
  prompt: string
  causal_triad: {
    ablation: SaeCausalTriadArm
    positive: SaeCausalTriadArm
    negative: SaeCausalTriadArm
  }
}

async function _fetch<T>(path: string, init?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(`${SAE_PATCH_URL}${path}`, {
      ...init,
      signal: AbortSignal.timeout(30_000),
    })
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  }
}

export async function saeHealth(): Promise<SaeHealthResponse | null> {
  return _fetch<SaeHealthResponse>('/sae/health')
}

export async function saeSteer(
  prompt: string,
  featureId: number,
  strength: number,
  maxNewTokens = 200,
): Promise<SaeSteerResponse | null> {
  return _fetch<SaeSteerResponse>('/sae/steer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, feature_id: featureId, strength, max_new_tokens: maxNewTokens }),
  })
}

export async function saeActivate(
  prompt: string,
  topK = 20,
): Promise<SaeActivateResponse | null> {
  return _fetch<SaeActivateResponse>('/sae/activate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, top_k: topK }),
  })
}

export async function saeCausalTriad(
  prompt: string,
  featureId: number,
  opts?: {
    ablationStrength?: number
    positiveStrength?: number
    negativeStrength?: number
    maxNewTokens?: number
  },
): Promise<SaeCausalTriadResponse | null> {
  return _fetch<SaeCausalTriadResponse>('/sae/causal_triad', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt,
      feature_id: featureId,
      ablation_strength: opts?.ablationStrength ?? 0.0,
      positive_strength: opts?.positiveStrength ?? 20.0,
      negative_strength: opts?.negativeStrength ?? -20.0,
      max_new_tokens: opts?.maxNewTokens ?? 200,
    }),
  })
}
