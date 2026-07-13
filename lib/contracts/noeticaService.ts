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
  openrouter?: string
  huggingface?: string
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
  reply_length?: 'short' | 'medium' | 'long'
  agent_mode?: 'auto' | 'plan' | 'ask'
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
  /** Operator self-attestation — arms the uncensored security lane under the 'security' profile. */
  security_attested?: boolean
  /** Override provider API base URL — supports local proxies and OpenAI-compatible endpoints */
  api_endpoint_override?: string
  /** Active project's knowledge-base collection id — retrieval is confined to it (project isolation). */
  collection_id?: string
  /** Retrieval breadth: 'chat' (only this chat's docs) | 'project' (chat + project KB, default) | 'everything'. */
  retrieval_scope?: 'chat' | 'project' | 'everything'
  /** Force external web research on for this turn (adds web_search + prefers fresh external sources). */
  web?: boolean
  /** Prophet Cloud Mesh opt-in — route inference to the sovereign cloud mesh (OpenAI-compatible). */
  prophet_mesh?: { enabled: boolean; endpoint: string; model?: string; api_key?: string }
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
  /** Provenance: how the answer was produced (recall | graphrag-global | extractive | …) + whether grounded. */
  method?: string
  grounded?: boolean
  decidable?: boolean
  replay_class?: string
  /** Verification badge — HOW this answer was proven (computed/reasoned/generated), the moat made visible. */
  verification?: ChatMessage['verification']
  /** Inline citations grounding the answer. */
  citations?: ChatMessage['citations']
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
