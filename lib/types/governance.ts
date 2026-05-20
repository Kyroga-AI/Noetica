import type { ExternalModelProviderRouteEvidence } from '@/lib/types/agentplane'

export interface GovernanceTrace {
  run_id: string
  model_routed: string
  provider: string
  policy_admitted: boolean
  memory_scope?: string
  memory_written: boolean
  evidence_ref?: string
  request_hash?: string
  evidence_hash?: string
  provider_route_evidence?: ExternalModelProviderRouteEvidence
  timestamp?: string
  latency_ms: number
}
