/**
 * graph-proposals.ts — the UX trust keystone AND the safe ontology-write-back layer. Never mutate the graph
 * opaquely: the agent STAGES proposed changes (add node/edge, remove edge, update prop) as ghost diffs the
 * user accepts or rejects per change on the graph rail. Only accepted proposals yield mutations. This turns
 * our differentiator (the graph) into a TRUST differentiator and makes ontology write-back shippable.
 */
export type ProposalOp = 'add-node' | 'add-edge' | 'remove-edge' | 'update-prop'
export interface GraphProposal {
  id: string
  op: ProposalOp
  payload: Record<string, unknown>      // e.g. { from, to, rel } or { node, prop, value }
  rationale: string
  source?: string
  status: 'pending' | 'accepted' | 'rejected'
}

let _seq = 0
export function proposal(op: ProposalOp, payload: Record<string, unknown>, rationale: string, source?: string): GraphProposal {
  return { id: `prop-${op}-${_seq++}`, op, payload, rationale, source, status: 'pending' }
}

/** Turn verified inferred facts into add-edge proposals (the write-back from inference). */
export function proposalsFromInferred(inferred: Array<{ subject: string; predicate: string; object: string; via?: string; verified?: boolean }>): GraphProposal[] {
  return inferred.map((f) => proposal('add-edge', { from: f.subject, to: f.object, rel: f.predicate }, f.verified ? `inferred + verified${f.via ? ` via ${f.via}` : ''}` : `inferred${f.via ? ` via ${f.via}` : ''}`, 'inference'))
}

export function setStatus(proposals: GraphProposal[], id: string, status: 'accepted' | 'rejected'): GraphProposal[] {
  return proposals.map((p) => (p.id === id ? { ...p, status } : p))
}

/** The mutations to apply = only the accepted proposals. Returns accepted + a diff summary. */
export function applyAccepted(proposals: GraphProposal[]): { mutations: GraphProposal[]; summary: { adds: number; removes: number; updates: number; pending: number } } {
  const mutations = proposals.filter((p) => p.status === 'accepted')
  return {
    mutations,
    summary: {
      adds: mutations.filter((p) => p.op === 'add-node' || p.op === 'add-edge').length,
      removes: mutations.filter((p) => p.op === 'remove-edge').length,
      updates: mutations.filter((p) => p.op === 'update-prop').length,
      pending: proposals.filter((p) => p.status === 'pending').length,
    },
  }
}
