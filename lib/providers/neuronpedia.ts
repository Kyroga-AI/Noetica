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
  const steerUrl = buildNeuronpediaSteerUrl(baseUrl)

  if (!apiKey && !isLoopbackUrl(steerUrl)) {
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

  const headers: Record<string, string> = {
    'content-type': 'application/json'
  }

  if (apiKey) {
    headers.authorization = `Bearer ${apiKey}`
  }

  const response = await fetch(steerUrl, {
    method: 'POST',
    headers,
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
  const isLocalhost = isLoopbackHost(parsed.hostname)

  if (trimmedPath.endsWith('/api')) {
    parsed.pathname = `${trimmedPath}/steer`
  } else if (isLocalhost) {
    parsed.pathname = `${trimmedPath}/steer`
  } else {
    parsed.pathname = `${trimmedPath}/api/steer`
  }

  return parsed.toString()
}

export function isLoopbackUrl(url: string): boolean {
  return isLoopbackHost(new URL(url).hostname)
}

function isLoopbackHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[/, '').replace(/\]$/, '')
  return normalized === 'localhost' || normalized.endsWith('.localhost') || normalized === '127.0.0.1' || normalized === '::1'
}
