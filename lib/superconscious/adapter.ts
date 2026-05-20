import type { SteeringConfig, SteeringResult } from '@/lib/types/steering'

export interface NoeticaTaskInput {
  session_id: string
  message: string
  mode: 'standalone' | 'sourceos'
  model_hint?: string
  steering?: SteeringConfig
  memory_scope?: string
}

export interface NoeticaTaskResult {
  run_id: string
  content: string
  model_routed: string
  provider: string
  policy_admitted: boolean
  memory_written: boolean
  steering_applied?: SteeringResult
  evidence_ref?: string
  latency_ms: number
}

// Authority boundary: Noetica owns this adapter interface only. Real routing and
// task execution belong to github.com/SocioProphet/superconscious and model
// selection belongs to github.com/SocioProphet/model-router.
export async function submitTask(input: NoeticaTaskInput): Promise<NoeticaTaskResult> {
  const started = Date.now()

  return {
    run_id: `mock-${crypto.randomUUID()}`,
    content: `SourceOS adapter stub accepted the task: ${input.message}`,
    model_routed: input.model_hint ?? 'model-router-pending',
    provider: 'superconscious',
    policy_admitted: true,
    memory_written: false,
    steering_applied: input.steering
      ? {
          status: 'noop',
          baseline: input.message,
          steered: input.message,
          diff_summary: 'SourceOS adapter stub records steering intent but applies no runtime intervention.',
          feature_id: input.steering.feature_id,
          layer: input.steering.layer,
          strength: input.steering.strength
        }
      : undefined,
    evidence_ref: 'agentplane://pending/noetica-m1-stub',
    latency_ms: Date.now() - started
  }
}
