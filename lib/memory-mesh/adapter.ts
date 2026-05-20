import type {
  MemoryRecallRequest,
  MemoryRecallResult,
  MemoryScopeRef,
  MemoryWriteProposal,
  MemoryWriteProposalResult
} from '@/lib/types/memory'

// Authority boundary: Noetica may display and request a memory scope, recall, or
// write proposal, but memory persistence, recall policy, and writeback admission
// belong to github.com/SocioProphet/memory-mesh. This adapter is a contract stub:
// no live recall, no durable writeback, and no raw memory payload storage.
export async function listMemoryScopes(): Promise<MemoryScopeRef[]> {
  return [
    {
      schema_version: 'noetica.memory.v0.1',
      scope_id: 'noetica-session-local',
      label: 'Noetica session-local scope',
      authority: 'SocioProphet/memory-mesh',
      writable: false,
      live_scope: false,
      writeback_policy: 'disabled',
      sensitive_payload_storage: 'disallowed',
      evidence_ref: 'memory-mesh://pending/noetica-session-local',
      notes: [
        'Noetica memory-mesh adapter is a contract stub.',
        'No live memoryd recall was performed.',
        'Durable writeback is disabled.'
      ]
    }
  ]
}

export async function recallMemory(request: MemoryRecallRequest): Promise<MemoryRecallResult> {
  return {
    schema_version: 'noetica.memory.v0.1',
    status: 'stubbed',
    request_id: request.request_id,
    scope_id: request.scope_id,
    authority: 'SocioProphet/memory-mesh',
    recall_performed: false,
    entries: [],
    evidence_ref: 'memory-mesh://pending/noetica-recall-stub',
    notes: [
      'No live Memory Mesh recall was performed.',
      'No raw memory content was read or returned.',
      'Recall policy and durable memory authority remain with memory-mesh.'
    ]
  }
}

export async function proposeMemoryWrite(proposal: MemoryWriteProposal): Promise<MemoryWriteProposalResult> {
  return {
    schema_version: 'noetica.memory.v0.1',
    status: 'not-submitted',
    proposal_id: proposal.proposal_id,
    scope_id: proposal.scope_id,
    authority: 'SocioProphet/memory-mesh',
    durable_write_performed: false,
    review_required: true,
    evidence_ref: 'memory-mesh://pending/noetica-write-proposal-stub',
    notes: [
      'No durable Memory Mesh writeback was performed.',
      'No raw memory payload was stored by Noetica.',
      'Future writeback must use memory-mesh review/admission flows.'
    ]
  }
}
