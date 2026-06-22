/**
 * sherlock-evidence.ts — integrate with SocioProphet/sherlock-search's Evidence-Answer Contract
 * (Anchor → Normalize → Propose). Noetica's RAG + grounding-verifier already does this segment of the loop
 * (Observe → Anchor → Normalize → Propose → Explain → Verify → Govern → Act → Receipt → Learn). This emits
 * our retrieval as a conformant Sherlock evidence answer: anchors (entities), normalized evidence (ranked
 * chunks), proposed claims — handing off the Verify/Govern stages to Holmes/Policy Fabric (which Sherlock
 * does NOT own, matching the contract's ownership boundary).
 */
export interface Anchor { id: string; label: string; kind: string }
export interface EvidenceItem { sourceRef: string; text: string; score: number }
export interface ProposedClaim { subject: string; predicate: string; object: string; support: number; verified?: boolean }

export interface EvidenceAnswer {
  contract: 'sherlock.evidence-answer.v0.1'
  segment: 'anchor->normalize->propose'
  query: string
  anchors: Anchor[]
  evidence: EvidenceItem[]
  proposedClaims: ProposedClaim[]
  handoff: { verify: 'holmes'; govern: 'policy-fabric' }   // stages Sherlock does NOT own
}

export function buildEvidenceAnswer(opts: {
  query: string
  anchors: Anchor[]
  evidence: EvidenceItem[]
  proposedClaims: ProposedClaim[]
}): EvidenceAnswer {
  return {
    contract: 'sherlock.evidence-answer.v0.1',
    segment: 'anchor->normalize->propose',
    query: opts.query,
    anchors: opts.anchors,
    evidence: [...opts.evidence].sort((a, b) => b.score - a.score),   // normalized = ranked
    proposedClaims: opts.proposedClaims,
    handoff: { verify: 'holmes', govern: 'policy-fabric' },
  }
}

/** Conformance: an evidence answer must carry anchors + evidence + the handoff boundary. */
export function conformsToEvidenceAnswer(a: Partial<EvidenceAnswer>): { conforms: boolean; missing: string[] } {
  const missing: string[] = []
  if (!a.query) missing.push('query')
  if (!a.anchors?.length) missing.push('anchors')
  if (!a.evidence) missing.push('evidence')
  if (!a.handoff?.verify) missing.push('handoff.verify')
  return { conforms: missing.length === 0, missing }
}
