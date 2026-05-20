import type { ModelConfig } from '@/lib/types/model'

export const models: ModelConfig[] = [
  {
    id: 'gpt-4.1-mini',
    label: 'GPT-4.1 mini',
    provider: 'openai',
    steering: 'none',
    local_capable: false,
    context_window: 1047576,
    description: 'Standalone OpenAI model for governed blackbox chat with provenance only.'
  },
  {
    id: 'claude-3-5-sonnet-latest',
    label: 'Claude 3.5 Sonnet',
    provider: 'anthropic',
    steering: 'none',
    local_capable: false,
    context_window: 200000,
    description: 'Standalone Anthropic model for governed blackbox chat with provenance only.'
  },
  {
    id: 'gpt2-small-neuronpedia',
    label: 'GPT-2 Small + Neuronpedia',
    provider: 'neuronpedia',
    steering: 'full',
    sae_source: 'neuronpedia',
    local_capable: true,
    context_window: 1024,
    description: 'White-box SAE target with hosted Neuronpedia feature support.'
  },
  {
    id: 'gemma-2-2b-it-neuronpedia',
    label: 'Gemma 2 2B IT + Neuronpedia',
    provider: 'neuronpedia',
    steering: 'full',
    sae_source: 'neuronpedia',
    local_capable: true,
    context_window: 8192,
    description: 'White-box open model target for hosted SAE steering experiments.'
  },
  {
    id: 'llama-3.1-8b-instruct',
    label: 'Llama 3.1 8B Instruct',
    provider: 'meta',
    steering: 'local',
    sae_source: 'custom',
    local_capable: true,
    context_window: 131072,
    description: 'Open-weight model: local SAE attachment possible through Agent Machine, not standalone API steering.'
  },
  {
    id: 'mistral-large-latest',
    label: 'Mistral Large',
    provider: 'mistral',
    steering: 'none',
    local_capable: false,
    context_window: 128000,
    description: 'Hosted Mistral provider placeholder; governed provenance only in standalone API mode.'
  },
  {
    id: 'gemini-1.5-pro',
    label: 'Gemini 1.5 Pro',
    provider: 'google',
    steering: 'none',
    local_capable: false,
    context_window: 1000000,
    description: 'Google blackbox provider placeholder; governed provenance only.'
  }
]

export const defaultModelId = models[0]?.id ?? 'gpt-4.1-mini'
