import type { ModelConfig } from '@/lib/types/model'

export const models: ModelConfig[] = [
  // ── Auto mesh routing (prophet-mesh) ─────────────────────────────────────────
  {
    id: 'auto',
    label: 'Auto (prophet-mesh)',
    provider: 'meta',
    steering: 'local',
    local_capable: true,
    context_window: 131072,
    description: 'Prophet-mesh routes each message to the best available local specialist. Coding → qwen2.5-coder, reasoning → deepseek-r1, writing → qwen2.5. Falls back to cloud if Ollama is unavailable and a key is set.',
  },

  // ── Anthropic ────────────────────────────────────────────────────────────────
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
    id: 'claude-haiku-4-5',
    label: 'Claude Haiku 4.5',
    provider: 'anthropic',
    steering: 'none',
    local_capable: false,
    context_window: 200000,
    description: 'Fast, cost-efficient Anthropic model for high-throughput tasks.'
  },
  {
    id: 'claude-opus-4-8',
    label: 'Claude Opus 4.8',
    provider: 'anthropic',
    steering: 'none',
    local_capable: false,
    context_window: 1000000,
    extended_thinking: true,
    description: 'Most capable Anthropic model for complex reasoning and analysis.'
  },

  // ── OpenAI ───────────────────────────────────────────────────────────────────
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
    id: 'o3',
    label: 'o3',
    provider: 'openai',
    steering: 'none',
    local_capable: false,
    context_window: 200000,
    extended_thinking: true,
    description: 'OpenAI o3 reasoning model for complex multi-step problems.'
  },

  // ── Neuronpedia-hosted SAE targets — GPT-2 family ───────────────────────────
  {
    id: 'gpt2-small-neuronpedia',
    label: 'GPT-2 Small + Neuronpedia',
    provider: 'neuronpedia',
    steering: 'full',
    sae_source: 'neuronpedia',
    local_capable: true,
    context_window: 1024,
    description: 'GPT-2 Small (117M) — best-studied SAE target. Anthropic/EleutherAI SAEs, 8 residual stream layers.'
  },
  {
    id: 'gpt2-medium-neuronpedia',
    label: 'GPT-2 Medium + Neuronpedia',
    provider: 'neuronpedia',
    steering: 'full',
    sae_source: 'neuronpedia',
    local_capable: true,
    context_window: 1024,
    description: 'GPT-2 Medium (345M) — wider feature space, residual + MLP SAEs available.'
  },
  {
    id: 'gpt2-large-neuronpedia',
    label: 'GPT-2 Large + Neuronpedia',
    provider: 'neuronpedia',
    steering: 'full',
    sae_source: 'neuronpedia',
    local_capable: true,
    context_window: 1024,
    description: 'GPT-2 Large (774M) — 36-layer depth, richer high-level semantic features.'
  },
  {
    id: 'gpt2-xl-neuronpedia',
    label: 'GPT-2 XL + Neuronpedia',
    provider: 'neuronpedia',
    steering: 'full',
    sae_source: 'neuronpedia',
    local_capable: true,
    context_window: 1024,
    description: 'GPT-2 XL (1.5B) — largest GPT-2. Most interpretable feature library in the Neuronpedia index.'
  },

  // ── Neuronpedia-hosted SAE targets — Gemma family ───────────────────────────
  {
    id: 'gemma-2-2b-it-neuronpedia',
    label: 'Gemma 2 2B IT + Neuronpedia',
    provider: 'neuronpedia',
    steering: 'full',
    sae_source: 'neuronpedia',
    local_capable: true,
    context_window: 8192,
    description: 'Gemma 2 2B IT — GemmaScope SAEs (Google DeepMind). Instruction-tuned, best for steering experiments.'
  },
  {
    id: 'gemma-2-9b-it-neuronpedia',
    label: 'Gemma 2 9B IT + Neuronpedia',
    provider: 'neuronpedia',
    steering: 'full',
    sae_source: 'neuronpedia',
    local_capable: true,
    context_window: 8192,
    description: 'Gemma 2 9B IT — larger GemmaScope model. Richer abstraction features, stronger reasoning features.'
  },
  {
    id: 'gemma-2-27b-neuronpedia',
    label: 'Gemma 2 27B + Neuronpedia',
    provider: 'neuronpedia',
    steering: 'full',
    sae_source: 'neuronpedia',
    local_capable: true,
    context_window: 8192,
    description: 'Gemma 2 27B — largest GemmaScope target. Requires significant GPU memory.'
  },
  {
    id: 'gemma-1-2b-neuronpedia',
    label: 'Gemma 1 2B + Neuronpedia',
    provider: 'neuronpedia',
    steering: 'full',
    sae_source: 'neuronpedia',
    local_capable: true,
    context_window: 8192,
    description: 'Gemma 1 2B — older Gemma generation, good baseline for cross-generation steering comparison.'
  },

  // ── Neuronpedia-hosted SAE targets — Llama family ────────────────────────────
  {
    id: 'llama-3-8b-neuronpedia',
    label: 'Llama 3 8B + Neuronpedia',
    provider: 'neuronpedia',
    steering: 'full',
    sae_source: 'neuronpedia',
    local_capable: true,
    context_window: 8192,
    description: 'Llama 3 8B base — sparse autoencoder trained on residual stream activations.'
  },
  {
    id: 'llama-3-70b-neuronpedia',
    label: 'Llama 3 70B + Neuronpedia',
    provider: 'neuronpedia',
    steering: 'full',
    sae_source: 'neuronpedia',
    local_capable: true,
    context_window: 8192,
    description: 'Llama 3 70B — large-scale SAE target. High-level conceptual features emerge at this scale.'
  },

  // ── Neuronpedia-hosted SAE targets — Mistral family ──────────────────────────
  {
    id: 'mistral-7b-v0.1-neuronpedia',
    label: 'Mistral 7B v0.1 + Neuronpedia',
    provider: 'neuronpedia',
    steering: 'full',
    sae_source: 'neuronpedia',
    local_capable: true,
    context_window: 32768,
    description: 'Mistral 7B v0.1 — sliding-window attention model with SAE features indexed by Neuronpedia.'
  },

  // ── Neuronpedia-hosted SAE targets — Pythia family (EleutherAI) ─────────────
  {
    id: 'pythia-70m-neuronpedia',
    label: 'Pythia 70M + Neuronpedia',
    provider: 'neuronpedia',
    steering: 'full',
    sae_source: 'eleutherai',
    local_capable: true,
    context_window: 2048,
    description: 'Pythia 70M — smallest deduped checkpoint. Ideal for fast steering experiments and mechanistic research.'
  },
  {
    id: 'pythia-160m-neuronpedia',
    label: 'Pythia 160M + Neuronpedia',
    provider: 'neuronpedia',
    steering: 'full',
    sae_source: 'eleutherai',
    local_capable: true,
    context_window: 2048,
    description: 'Pythia 160M — small scale, well-studied feature geometry.'
  },
  {
    id: 'pythia-410m-neuronpedia',
    label: 'Pythia 410M + Neuronpedia',
    provider: 'neuronpedia',
    steering: 'full',
    sae_source: 'eleutherai',
    local_capable: true,
    context_window: 2048,
    description: 'Pythia 410M — intermediate scale. Phase transitions in feature complexity observed here.'
  },
  {
    id: 'pythia-1b-neuronpedia',
    label: 'Pythia 1B + Neuronpedia',
    provider: 'neuronpedia',
    steering: 'full',
    sae_source: 'eleutherai',
    local_capable: true,
    context_window: 2048,
    description: 'Pythia 1B — 1B parameter checkpoint. Well-documented EleutherAI SAE suite.'
  },
  {
    id: 'pythia-1.4b-neuronpedia',
    label: 'Pythia 1.4B + Neuronpedia',
    provider: 'neuronpedia',
    steering: 'full',
    sae_source: 'eleutherai',
    local_capable: true,
    context_window: 2048,
    description: 'Pythia 1.4B — richer feature space than 1B, still tractable for steering research.'
  },
  {
    id: 'pythia-2.8b-neuronpedia',
    label: 'Pythia 2.8B + Neuronpedia',
    provider: 'neuronpedia',
    steering: 'full',
    sae_source: 'eleutherai',
    local_capable: true,
    context_window: 2048,
    description: 'Pythia 2.8B — exhibits emergent reasoning features. Strong benchmark for SAE interventions.'
  },
  {
    id: 'pythia-6.9b-neuronpedia',
    label: 'Pythia 6.9B + Neuronpedia',
    provider: 'neuronpedia',
    steering: 'full',
    sae_source: 'eleutherai',
    local_capable: true,
    context_window: 2048,
    description: 'Pythia 6.9B — near-7B scale. High-level feature emergence comparable to Mistral 7B family.'
  },
  {
    id: 'pythia-12b-neuronpedia',
    label: 'Pythia 12B + Neuronpedia',
    provider: 'neuronpedia',
    steering: 'full',
    sae_source: 'eleutherai',
    local_capable: true,
    context_window: 2048,
    description: 'Pythia 12B — largest Pythia checkpoint. Rich feature vocabulary for large-scale interpretability.'
  },

  // ── Neuronpedia-hosted SAE targets — GPT-J / GPT-NeoX ───────────────────────
  {
    id: 'gpt-j-6b-neuronpedia',
    label: 'GPT-J 6B + Neuronpedia',
    provider: 'neuronpedia',
    steering: 'full',
    sae_source: 'eleutherai',
    local_capable: true,
    context_window: 2048,
    description: 'GPT-J 6B — parallel attention architecture. Well-studied in early mechanistic interpretability literature.'
  },
  {
    id: 'gpt-neox-20b-neuronpedia',
    label: 'GPT-NeoX 20B + Neuronpedia',
    provider: 'neuronpedia',
    steering: 'full',
    sae_source: 'eleutherai',
    local_capable: true,
    context_window: 2048,
    description: 'GPT-NeoX 20B — 20B open model. One of the largest fully open models with SAE coverage.'
  },

  // ── Local Ollama models (default-visible, routed via prophet-mesh) ───────────
  {
    id: 'llama3.2:3b',
    label: 'Llama 3.2 3B (local)',
    provider: 'meta',
    steering: 'local',
    local_capable: true,
    context_window: 131072,
    description: 'Fast local Llama 3.2 3B via Ollama — default conversational model.'
  },
  {
    id: 'qwen2.5:7b',
    label: 'Qwen 2.5 7B (local)',
    provider: 'meta',
    steering: 'local',
    local_capable: true,
    context_window: 131072,
    description: 'Local Qwen 2.5 7B via Ollama — general-purpose and writing tasks.'
  },
  {
    id: 'qwen2.5-coder:7b',
    label: 'Qwen 2.5 Coder 7B (local)',
    provider: 'meta',
    steering: 'local',
    local_capable: true,
    context_window: 131072,
    description: 'Local Qwen 2.5 Coder 7B via Ollama — code generation and debugging.'
  },
  {
    id: 'deepseek-r1:8b',
    label: 'DeepSeek R1 8B (local)',
    provider: 'meta',
    steering: 'local',
    local_capable: true,
    context_window: 65536,
    description: 'Local DeepSeek R1 8B via Ollama — reasoning and complex analysis.'
  },
  {
    id: 'qwen2.5:14b',
    label: 'Qwen 2.5 14B (local)',
    provider: 'meta',
    steering: 'local',
    local_capable: true,
    context_window: 131072,
    description: 'Local Qwen 2.5 14B via Ollama — strongest local general model, ~GPT-3.5 Turbo tier. Requires ~9GB VRAM.',
  },

  // ── Hosted API providers (blackbox) ─────────────────────────────────────────
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
  },
]

export const defaultModelId = 'auto'

// Models shown in the picker by default (local-first). All others require showAllModels=true.
export function visibleModels(showAll: boolean) {
  if (showAll) return models
  return models.filter(
    (m) => m.id === 'auto' || m.provider === 'meta'
  )
}
