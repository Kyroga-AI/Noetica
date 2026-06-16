import type { ModelConfig } from '@/lib/types/model'

// Resolve the wire-level model id sent to each provider. An env override lets an
// operator pin a deployment to a specific upstream model (e.g. a pre-release
// snapshot or a locally-pulled Ollama tag) without changing the catalog.
export function resolveProviderModelId(model: ModelConfig): string {
  switch (model.provider) {
    case 'anthropic':
      return process.env.ANTHROPIC_MODEL_ID?.trim() || model.id
    case 'openai':
      return process.env.OPENAI_MODEL_ID?.trim() || model.id
    case 'google':
      return process.env.GOOGLE_MODEL_ID?.trim() || model.id
    case 'mistral':
      return process.env.MISTRAL_MODEL_ID?.trim() || model.id
    case 'meta':
      // Ollama tag (e.g. "llama3.1:8b-instruct-q4_K_M"); falls back to the catalog id.
      return process.env.OLLAMA_MODEL_ID?.trim() || model.id
    default:
      return model.id
  }
}
