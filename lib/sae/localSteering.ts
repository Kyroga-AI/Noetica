import type { SteeringConfig, SteeringResult } from '@/lib/types/steering'
import { getFeature } from './features'

// Local prompt-injection approximation of SAE steering.
// This is not equivalent to activation-space steering — it works by prepending
// a directional hint derived from the feature's known semantic direction.
// When a live Neuronpedia or Agent Machine endpoint is available, prefer that.
export function runLocalSteering(prompt: string, config: SteeringConfig): SteeringResult {
  const feature = getFeature(config.feature_id)

  if (!feature?.prompt_hint) {
    return {
      status: 'noop',
      baseline: prompt,
      steered: prompt,
      diff_summary: `Feature '${config.feature_id}' not found in local registry — no steering applied.`,
      feature_id: config.feature_id,
      layer: config.layer,
      strength: config.strength,
    }
  }

  const abs = Math.abs(config.strength)
  if (abs < 0.05) {
    return {
      status: 'noop',
      baseline: prompt,
      steered: prompt,
      diff_summary: 'Strength too low — no steering applied.',
      feature_id: config.feature_id,
      layer: config.layer,
      strength: config.strength,
    }
  }

  // Positive strength → apply hint; negative strength → invert with "avoid X" framing
  const direction = config.strength > 0 ? 'emphasize' : 'avoid'
  const hintText = config.strength > 0
    ? feature.prompt_hint
    : `Do NOT ${feature.prompt_hint.toLowerCase().replace(/^be /i, 'be ').replace(/^adopt /i, 'adopt ').replace(/^frame /i, 'frame ')}. Take the opposite approach.`

  const intensityNote = abs >= 1.5 ? 'Very strongly' : abs >= 0.8 ? 'Strongly' : 'Mildly'
  const prefix = `[Local SAE steering — ${intensityNote} ${direction} feature '${feature.label}' (strength ${config.strength})]\n${hintText}\n\n`

  const steered = prefix + prompt

  return {
    status: 'applied',
    baseline: prompt,
    steered,
    diff_summary: `Local prompt-injection steering applied for '${feature.label}' (strength ${config.strength}, layer ${config.layer}). Prepended directional hint. Note: this is semantic approximation, not activation-space SAE steering.`,
    feature_id: config.feature_id,
    layer: config.layer,
    strength: config.strength,
  }
}
