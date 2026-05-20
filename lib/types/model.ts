export type Provider = 'neuronpedia' | 'anthropic' | 'openai' | 'google' | 'meta' | 'mistral' | 'xai'

export type SteeringCapability = 'full' | 'local' | 'none'

export type SaeSource = 'neuronpedia' | 'eleutherai' | 'custom'

export interface ModelConfig {
  id: string
  label: string
  provider: Provider
  steering: SteeringCapability
  sae_source?: SaeSource
  local_capable: boolean
  context_window: number
  description: string
}
