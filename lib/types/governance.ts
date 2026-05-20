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
  timestamp?: string
  latency_ms: number
}
