export type NoeticaMemorySchemaVersion = 'noetica.memory.v0.1'
export type MemoryAdapterStatus = 'stubbed' | 'available' | 'unavailable' | 'blocked'
export type MemoryWritebackPolicy = 'disabled' | 'review-only' | 'allowed-with-policy'
export type SensitivePayloadStorage = 'disallowed' | 'allowed-with-policy'

export interface MemoryScopeRef {
  schema_version: NoeticaMemorySchemaVersion
  scope_id: string
  label: string
  authority: 'SocioProphet/memory-mesh'
  writable: boolean
  live_scope: boolean
  writeback_policy: MemoryWritebackPolicy
  sensitive_payload_storage: SensitivePayloadStorage
  evidence_ref?: string
  notes: string[]
}

export interface MemoryRecallRequest {
  schema_version: NoeticaMemorySchemaVersion
  request_id: string
  session_id: string
  agent_id: 'noetica'
  scope_id: string
  query_hash: string
  limit?: number
  policy_ref?: string
}

export interface MemoryRecallEntry {
  memory_id: string
  content_hash: string
  source_ref?: string
  score?: number
}

export interface MemoryRecallResult {
  schema_version: NoeticaMemorySchemaVersion
  status: MemoryAdapterStatus
  request_id: string
  scope_id: string
  authority: 'SocioProphet/memory-mesh'
  recall_performed: boolean
  entries: MemoryRecallEntry[]
  evidence_ref?: string
  notes: string[]
}

export interface MemoryWriteProposal {
  schema_version: NoeticaMemorySchemaVersion
  proposal_id: string
  session_id: string
  agent_id: 'noetica'
  scope_id: string
  content_hash: string
  source_evidence_refs: string[]
  policy_ref?: string
}

export interface MemoryWriteProposalResult {
  schema_version: NoeticaMemorySchemaVersion
  status: 'not-submitted' | 'review-required' | 'blocked'
  proposal_id: string
  scope_id: string
  authority: 'SocioProphet/memory-mesh'
  durable_write_performed: boolean
  review_required: boolean
  evidence_ref?: string
  notes: string[]
}
