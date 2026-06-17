import type { ExternalModelProviderRouteEvidence } from '@/lib/types/agentplane'
import type { SourceOSInteractionEvent } from '@/lib/types/sourceos-interaction'
import type { SteeringConfig, SteeringResult } from '@/lib/types/steering'

export type NoeticaTaskSchemaVersion = 'noetica.task.v0.1'
export type NoeticaAgentId = 'noetica'
export type NoeticaTaskMode = 'standalone' | 'sourceos'
export type NoeticaTaskStatus = 'success' | 'accepted' | 'blocked' | 'unavailable' | 'stubbed'

export interface GrantResolutionRefs {
  requested: string[]
  resolved: string[]
  missing: string[]
}

export interface NoeticaTaskInput {
  schema_version: NoeticaTaskSchemaVersion
  session_id: string
  agent_id: NoeticaAgentId
  message: string
  mode: NoeticaTaskMode
  model_hint?: string
  steering_hint?: SteeringConfig
  tool_grant_refs: string[]
  memory_scope_ref?: string
  request_hash: string
  agentplane_evidence_ref?: string
  // Passed through for local direct-provider fallback when no live superconscious endpoint is available
  provider_keys?: { anthropic?: string; openai?: string; google?: string; mistral?: string }
  // Full message history for multi-turn context in direct-provider fallback
  messages?: import('@/lib/types/message').ChatMessage[]
  system_prompt?: string
}

export interface NoeticaTaskResult {
  schema_version: NoeticaTaskSchemaVersion
  status: NoeticaTaskStatus
  run_id: string
  content: string
  model_routed: string
  provider: string
  model_overridden: boolean
  policy_admitted: boolean
  policy_ref?: string
  grant_refs: GrantResolutionRefs
  steering_applied?: SteeringResult
  memory_written: boolean
  memory_scope_ref?: string
  agentplane_run_id?: string
  evidence_ref?: string
  replay_ref?: string
  provider_route_evidence?: ExternalModelProviderRouteEvidence
  sourceos_interaction_event?: SourceOSInteractionEvent
  request_hash?: string
  evidence_hash?: string
  timestamp?: string
  latency_ms: number
}
