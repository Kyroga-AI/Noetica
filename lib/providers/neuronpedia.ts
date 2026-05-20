import { optionalEnv } from '@/lib/utils/env'
import type { SteeringConfig, SteeringResult } from '@/lib/types/steering'

type SteeringInput = {
  prompt: string
  model_id: string
  steering: SteeringConfig
}

export async function runNeuronpediaSteering(input: SteeringInput): Promise<SteeringResult> {
  const baseUrl = optionalEnv('NEURONPEDIA_BASE_URL') ?? 'https://www.neuronpedia.org/api'
  const apiKey = optionalEnv('NEURONPEDIA_API_KEY')

  if (!apiKey) {
    return {
      status: 'not_configured',
      baseline: input.prompt,
      steered: input.prompt,
      diff_summary: 'Neuronpedia API key not configured; returning explicit no-op steering result.',
      feature_id: input.steering.feature_id,
      layer: input.steering.layer,
      strength: input.steering.strength
    }
  }

  const response = await fetch(`${baseUrl}/steer`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(input)
  })

  if (!response.ok) {
    const details = await response.text()
    throw new Error(`Neuronpedia steering request failed: ${response.status} ${details}`)
  }

  const result = (await response.json()) as Omit<SteeringResult, 'status'> & {
    status?: SteeringResult['status']
  }

  return {
    ...result,
    status: result.status ?? 'applied'
  }
}
