import type { ExternalModelProviderRouteEvidence } from '@/lib/types/agentplane'
import type { SourceOSInteractionEvent } from '@/lib/types/sourceos-interaction'
import type { GrantResolutionRefs, NoeticaTaskStatus } from '@/lib/types/task'

export interface GovernanceTrace {
  run_id: string
  model_routed: string
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
  method?: string       // how the answer was produced: recall | graphrag-global | extractive | generation | …
  grounded?: boolean    // answer is grounded in retrieved/cited evidence (provenance signal)
}
