import { NextResponse } from 'next/server'
import { saeSteer } from '@/lib/sae/saeClient'
import { runLocalSteering } from '@/lib/sae/localSteering'
import type { SteeringConfig } from '@/lib/types/steering'

export const runtime = 'nodejs'

type SteerRequest = {
  prompt: string
  steering: SteeringConfig
  max_new_tokens?: number
}

export async function POST(request: Request) {
  const body = (await request.json()) as SteerRequest
  const { prompt, steering, max_new_tokens = 200 } = body

  if (!prompt?.trim()) {
    return NextResponse.json({ error: 'prompt_required' }, { status: 400 })
  }
  if (!steering?.feature_id) {
    return NextResponse.json({ error: 'steering_required' }, { status: 400 })
  }

  // Try real SAE activation patching if feature_id is numeric
  const numericId = parseInt(steering.feature_id, 10)
  if (!isNaN(numericId)) {
    const saeResult = await saeSteer(prompt, numericId, steering.strength, max_new_tokens)
    if (saeResult?.ok) {
      return NextResponse.json({
        ok: true,
        source: 'sae_patch',
        status: 'applied',
        baseline: prompt,
        steered: saeResult.steered_completion,
        diff_summary: `Real SAE activation patch — feature ${saeResult.feature_id} @ ${saeResult.hook}, strength ${saeResult.strength}, Δresid_norm ${saeResult.resid_delta_norm.toFixed(3)}`,
        feature_id: steering.feature_id,
        layer: steering.layer,
        strength: steering.strength,
        sae_meta: {
          original_feature_activation: saeResult.original_feature_activation,
          resid_delta_norm: saeResult.resid_delta_norm,
          hook: saeResult.hook,
        },
      })
    }
  }

  // Fallback: prompt-injection approximation
  const local = runLocalSteering(prompt, steering)
  return NextResponse.json({ ok: true, source: 'local_prompt_injection', ...local })
}
