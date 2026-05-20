import { optionalEnv } from '@/lib/utils/env'
import type { SteeringConfig, SteeringResult } from '@/lib/types/steering'

type SteeringInput = {
  prompt: string
  model_id: string
  steering: SteeringConfig
}

const DEFAULT_NEURONPEDIA_BASE_URL = 'https://www.neuronpedia.org'

export async function runNeuronpediaSteering(input: SteeringInput): Promise<SteeringResult> {
  const baseUrl = optionalEnv('NEURONPEDIA_BASE_URL') ?? DEFAULT_NEURONPEDIA_BASE_URL
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

  const response = await fetch(buildNeuronpediaSteerUrl(baseUrl), {
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

export function buildNeuronpediaSteerUrl(baseUrl: string): string {
  const parsed = new URL(baseUrl)
  const trimmedPath = parsed.pathname.replace(/\/$/, '')
  const isLocalhost = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '::1'

  if (trimmedPath.endsWith('/api')) {
    parsed.pathname = `${trimmedPath}/steer`
  } else if (isLocalhost) {
    parsed.pathname = `${trimmedPath}/steer`
  } else {
    parsed.pathname = `${trimmedPath}/api/steer`
  }

  return parsed.toString()
}
