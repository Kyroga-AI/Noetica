import type { GovernanceTrace } from '@/lib/types/governance'
import type { ChatMessage } from '@/lib/types/message'
import type { SteeringConfig, SteeringResult } from '@/lib/types/steering'

export type NoeticaMode = 'standalone' | 'sourceos'

export type NoeticaServiceEndpointKind = 'browser-fallback' | 'local-service' | 'sourceos' | 'agent-machine'

export type NoeticaServiceCapabilityStatus = 'ready' | 'not_configured' | 'disabled' | 'deferred' | 'error'

/** Provider API keys forwarded from browser settings (desktop-local; not transmitted externally). */
export type NoeticaProviderKeys = {
  anthropic?: string
  openai?: string
  google?: string
  mistral?: string
  neuronpedia?: string
}

export type NoeticaChatRequest = {
  session_id: string
  mode: NoeticaMode
  model_id: string
  messages: ChatMessage[]
  steering?: SteeringConfig
  memory_scope: string
  thinking_budget?: number
  /** User-supplied API keys from browser settings — used when server env vars are absent. */
  provider_keys?: NoeticaProviderKeys
  /** When set, chat requests are proxied to this Agent Machine endpoint instead of calling providers directly. */
  agent_machine_endpoint?: string
}

export type NoeticaSteerRequest = {
  prompt: string
  model_id: string
  steering: SteeringConfig
}

export type NoeticaServiceStatus = {
  schema_version: 'noetica.service.status.v0.1'
  endpoint_kind: NoeticaServiceEndpointKind
  desktop_mode: 'static-ui' | 'dev-server'
  chat: NoeticaServiceCapabilityStatus
  steer: NoeticaServiceCapabilityStatus
  provider: NoeticaServiceCapabilityStatus
  sourceos_route: NoeticaServiceCapabilityStatus
  agent_machine: NoeticaServiceCapabilityStatus
  prophet_mesh: NoeticaServiceCapabilityStatus
  notes?: string[]
}

export type NoeticaStreamEvent = {
  event: string
  data: string
}

export type NoeticaStreamDoneResult = {
  run_id: string
  content: string
  model_routed: string
  provider: string
  model_overridden?: boolean
  policy_admitted: boolean
  policy_ref?: string
  memory_scope_ref?: string
  memory_written: boolean
  evidence_ref?: string
  replay_ref?: string
  agentplane_run_id?: string
  request_hash?: string
  evidence_hash?: string
  provider_route_evidence?: GovernanceTrace['provider_route_evidence']
  grant_refs?: GovernanceTrace['grant_refs']
  sourceos_status?: GovernanceTrace['sourceos_status']
  status?: GovernanceTrace['sourceos_status']
  timestamp?: string
  latency_ms: number
  steering_applied?: ChatMessage['steering_result']
}

export type NoeticaSteerResponse = {
  result: SteeringResult
}

export const noeticaBrowserFallbackStatus: NoeticaServiceStatus = {
  schema_version: 'noetica.service.status.v0.1',
  endpoint_kind: 'browser-fallback',
  desktop_mode: 'static-ui',
  chat: 'ready',
  steer: 'ready',
  provider: 'ready',
  sourceos_route: 'deferred',
  agent_machine: 'deferred',
  prophet_mesh: 'deferred',
  notes: [
    'Next API routes are fallback/transitional runtime endpoints.',
    'Durable runtime authority belongs behind a local service, SourceOS endpoint, Agent Machine endpoint, or model-router layer.'
  ]
}
