import { NextResponse } from 'next/server'
import { saeSteer } from '@/lib/sae/saeClient'
import { runNeuronpediaSteering } from '@/lib/providers/neuronpedia'
import { runLocalSteering } from '@/lib/sae/localSteering'
import type { NoeticaSteerRequest } from '@/lib/contracts/noeticaService'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  const body = (await request.json()) as Partial<NoeticaSteerRequest>

  if (!body.prompt?.trim()) {
    return NextResponse.json({ error: 'prompt_required' }, { status: 400 })
  }
  if (!body.model_id?.trim()) {
    return NextResponse.json({ error: 'model_id_required' }, { status: 400 })
  }
  if (!body.steering) {
    return NextResponse.json({ error: 'steering_required' }, { status: 400 })
  }

  // 1. Try SAE sidecar (real residual-stream patching via TransformerLens)
  const numericFeatureId = parseInt(body.steering.feature_id, 10)
  if (!isNaN(numericFeatureId)) {
    const saeResult = await saeSteer(body.prompt, numericFeatureId, body.steering.strength)
    if (saeResult?.ok) {
      return NextResponse.json({
        result: {
          status: 'applied',
          steered: saeResult.steered_completion,
          hook: saeResult.hook,
          original_feature_activation: saeResult.original_feature_activation,
          resid_delta_norm: saeResult.resid_delta_norm,
        },
        source: 'sae_patch',
      })
    }
  }

  // 2. Neuronpedia (external hosted SAE — no API key configured, so almost always skipped)
  const neuronpediaResult = await runNeuronpediaSteering({
    prompt: body.prompt,
    model_id: body.model_id,
    steering: body.steering,
  })
  if (neuronpediaResult.status !== 'not_configured') {
    return NextResponse.json({ result: neuronpediaResult, source: 'neuronpedia' })
  }

  // 3. Local prompt-injection approximation
  const localResult = runLocalSteering(body.prompt, body.steering)
  return NextResponse.json({ result: localResult, source: 'local-sae-registry' })
}
