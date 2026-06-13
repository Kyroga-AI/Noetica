import type { ModelConfig } from '@/lib/types/model'

export const models: ModelConfig[] = [
  {
    id: 'claude-sonnet-4-6',
    label: 'Claude Sonnet 4.6',
    provider: 'anthropic',
    steering: 'none',
    local_capable: false,
    context_window: 1000000,
    extended_thinking: true,
    description: 'Anthropic blackbox provider for live standalone chat with provenance only.'
  },
  {
    id: 'gpt-4o',
    label: 'GPT-4o',
    provider: 'openai',
    steering: 'none',
    local_capable: false,
    context_window: 128000,
    description: 'OpenAI blackbox provider for live standalone chat with provenance only.'
  },
  {
    id: 'gpt-4o-mini',
    label: 'GPT-4o mini',
    provider: 'openai',
    steering: 'none',
    local_capable: false,
    context_window: 128000,
    description: 'Lower-cost OpenAI blackbox provider for live standalone chat with provenance only.'
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
    id: 'gemini-2.5-pro',
    label: 'Gemini 2.5 Pro',
    provider: 'google',
    steering: 'none',
    local_capable: false,
    context_window: 1000000,
    description: 'Google blackbox provider placeholder; governed provenance only.'
  }
]

export const defaultModelId = models[0]?.id ?? 'claude-sonnet-4-6'
