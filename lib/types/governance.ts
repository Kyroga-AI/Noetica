import type { ExternalModelProviderRouteEvidence } from '@/lib/types/agentplane'
import type { SourceOSInteractionEvent } from '@/lib/types/sourceos-interaction'
import type { GrantResolutionRefs, NoeticaTaskStatus } from '@/lib/types/task'

export interface GovernanceTrace {
  run_id: string
  model_routed: string
  /** Why the router chose this model — from router.ts rationale field */
  model_route_reason?: string
  provider: string
  model_overridden?: boolean
  policy_admitted: boolean
  policy_ref?: string
  memory_scope?: string
  memory_scope_ref?: string
  memory_written: boolean
  evidence_ref?: string
  replay_ref?: string
  agentplane_run_id?: string
  request_hash?: string
  evidence_hash?: string
  provider_route_evidence?: ExternalModelProviderRouteEvidence
  sourceos_interaction_event?: SourceOSInteractionEvent
  grant_refs?: GrantResolutionRefs
  sourceos_status?: NoeticaTaskStatus
  timestamp?: string
  latency_ms: number
  input_tokens?: number
  output_tokens?: number
  method?: string       // how the answer was produced: recall | graphrag-global | extractive | generation | operatorProgramOfThought | …
  grounded?: boolean    // answer is grounded in retrieved/cited evidence (provenance signal)
  decidable?: boolean   // question was answered by logic/compute (no generation needed)
  replay_class?: string // replayability tier: exact | approximate | generative
  /** C2PA-style content credential (EU AI Act Art.50 marking) */
  credential?: { digest: string; model: string; timestamp: string; aiGenerated: true }
}
