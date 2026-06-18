import type { GovernanceTrace } from '@/lib/types/governance'
import type { ChatMessage } from '@/lib/types/message'
import type { SteeringConfig, SteeringResult } from '@/lib/types/steering'
import type { ProviderTool, ToolUseBlock } from '@/lib/providers'

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
  serper?: string
}

export type { ProviderTool, ToolUseBlock }

export type NoeticaChatRequest = {
  session_id: string
  mode: NoeticaMode
  model_id?: string
  messages: ChatMessage[]
  steering?: SteeringConfig
  memory_scope: string
  thinking_budget?: number
  temperature?: number
  max_tokens?: number
  top_p?: number
  /** User-supplied API keys from browser settings — used when server env vars are absent. */
  provider_keys?: NoeticaProviderKeys
  /** When set, chat requests are proxied to this Agent Machine endpoint instead of calling providers directly. */
  agent_machine_endpoint?: string
  /** Tool definitions to pass to the model (MCP + built-in). */
  tools?: ProviderTool[]
  /** Optional system prompt override for this request. */
  system_prompt?: string
  /** Policy profile from GovernSurface settings — 'default' | 'strict' | 'permissive' */
  policy_profile?: string
  /** Override provider API base URL — supports local proxies and OpenAI-compatible endpoints */
  api_endpoint_override?: string
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
  input_tokens?: number
  output_tokens?: number
  cost_usd?: number
  tokens_egressed?: number
  steering_applied?: ChatMessage['steering_result']
  /** Set when model requested tool execution — client handles the agentic loop */
  tool_calls?: ToolUseBlock[]
  stop_reason?: 'end_turn' | 'tool_use' | 'max_tokens' | string
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
