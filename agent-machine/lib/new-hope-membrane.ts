/**
 * new-hope-membrane.ts — integrate with SocioProphet/new-hope (Higher-Order Semantic Runtime: carrier →
 * receptor → membrane → runtime). Noetica already gates ingest/egress (rag-trust trust-tiering, capability-
 * egress); now those decisions emit CONFORMANT PersonalIntelligenceCellMembraneEvents so the membrane
 * decision is governed/replayable the new-hope way. Required: schemaVersion, carrierRef, receptorRef,
 * membraneRef, membraneOutcome, policyDecision, message, lineage, emittedAt.
 */
export type MembraneOutcome = 'admit' | 'deny' | 'quarantine' | 'transform'
export type PolicyDecision = 'allow' | 'deny' | 'review'

export interface MembraneEvent {
  schemaVersion: string
  carrierRef: string
  receptorRef: string
  membraneRef: string
  membraneOutcome: MembraneOutcome
  policyDecision: PolicyDecision
  message: string
  lineage: string[]
  emittedAt: string
}

/** Map our rag-trust / capability-egress decision onto the new-hope membrane vocabulary. */
export function outcomeFor(d: { trust?: 'trusted' | 'internal' | 'untrusted'; injected?: boolean; allowed?: boolean }): { membraneOutcome: MembraneOutcome; policyDecision: PolicyDecision } {
  if (d.injected && d.trust === 'untrusted') return { membraneOutcome: 'deny', policyDecision: 'deny' }
  if (d.allowed === false) return { membraneOutcome: 'deny', policyDecision: 'deny' }
  if (d.trust === 'untrusted') return { membraneOutcome: 'quarantine', policyDecision: 'review' }
  return { membraneOutcome: 'admit', policyDecision: 'allow' }
}

export function membraneEvent(opts: {
  carrierRef: string; receptorRef?: string; membraneRef?: string; message: string; lineage?: string[]; emittedAt: string
  decision: { trust?: 'trusted' | 'internal' | 'untrusted'; injected?: boolean; allowed?: boolean }
}): MembraneEvent {
  const { membraneOutcome, policyDecision } = outcomeFor(opts.decision)
  return {
    schemaVersion: '0.2',
    carrierRef: opts.carrierRef,
    receptorRef: opts.receptorRef ?? 'noetica-graph',
    membraneRef: opts.membraneRef ?? 'noetica-rag-trust-membrane',
    membraneOutcome, policyDecision,
    message: opts.message,
    lineage: opts.lineage ?? [opts.carrierRef],
    emittedAt: opts.emittedAt,
  }
}

const REQUIRED = ['schemaVersion', 'carrierRef', 'receptorRef', 'membraneRef', 'membraneOutcome', 'policyDecision', 'message', 'lineage', 'emittedAt'] as const
export function conformsToMembrane(e: Partial<MembraneEvent>): { conforms: boolean; missing: string[] } {
  // Explicit, readable rule (the old mixed ||/ternary mis-parsed): a field is missing iff null/'' — and
  // lineage must additionally be a non-empty array.
  const missing = REQUIRED.filter((k) => {
    const v = e[k]
    if (k === 'lineage') return !Array.isArray(v) || v.length === 0
    return v == null || v === ''
  })
  return { conforms: missing.length === 0, missing }
}
