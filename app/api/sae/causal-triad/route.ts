import { NextResponse } from 'next/server'
import { saeCausalTriad } from '@/lib/sae/saeClient'
import { ingestCausalTriad } from '@/lib/hellgraph/ingest'

export const runtime = 'nodejs'

type CausalTriadRequest = {
  prompt: string
  feature_id: number
  session_id?: string
  ablation_strength?: number
  positive_strength?: number
  negative_strength?: number
  max_new_tokens?: number
}

export async function POST(request: Request) {
  const body = (await request.json()) as CausalTriadRequest
  const { prompt, feature_id, session_id } = body

  if (!prompt?.trim()) return NextResponse.json({ error: 'prompt_required' }, { status: 400 })
  if (feature_id === undefined || isNaN(feature_id)) return NextResponse.json({ error: 'feature_id_required' }, { status: 400 })

  const result = await saeCausalTriad(prompt, feature_id, {
    ablationStrength:  body.ablation_strength,
    positiveStrength:  body.positive_strength,
    negativeStrength:  body.negative_strength,
    maxNewTokens:      body.max_new_tokens,
  })

  if (!result?.ok) {
    return NextResponse.json({ error: 'sae_sidecar_unavailable', hint: 'Start sae_patch.py on port 8138' }, { status: 503 })
  }

  // Ingest into HellGraph for M1 certification trail
  const triad = result.causal_triad
  const timestamp = new Date().toISOString()
  const graphNode = ingestCausalTriad({
    featureId:     feature_id,
    hook:          result.hook,
    prompt,
    schemaVersion: result.schema_version,
    timestamp,
    sessionId:     session_id,
    ablation: triad.ablation.steered_completion ? {
      completion:          triad.ablation.steered_completion,
      originalActivation:  triad.ablation.original_feature_activation,
      residDeltaNorm:      triad.ablation.resid_delta_norm,
    } : undefined,
    positive: triad.positive.steered_completion ? {
      completion:          triad.positive.steered_completion,
      originalActivation:  triad.positive.original_feature_activation,
      residDeltaNorm:      triad.positive.resid_delta_norm,
    } : undefined,
    negative: triad.negative.steered_completion ? {
      completion:          triad.negative.steered_completion,
      originalActivation:  triad.negative.original_feature_activation,
      residDeltaNorm:      triad.negative.resid_delta_norm,
    } : undefined,
  })

  const { ok: _ok, ...resultRest } = result
  return NextResponse.json({
    ok: true,
    ...resultRest,
    hellgraph_node: graphNode,
    timestamp,
  })
}
