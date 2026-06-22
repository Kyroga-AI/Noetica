/**
 * capability-egress.ts — CaMeL-style capability-based egress control (Google DeepMind, arXiv 2503.18813). The
 * structural fix for indirect prompt injection that filters can't guarantee: a value derived from untrusted
 * data carries the 'untrusted' capability, and a tool call / egress is gated on the CAPABILITY OF ITS
 * ARGUMENTS — not just a grant-check on the tool. Feeds SCOPE-D the data-provenance signal it lacks.
 */
import { type TrustTier, deriveTrust } from './rag-trust.js'

const RANK: Record<TrustTier, number> = { untrusted: 0, internal: 1, trusted: 2 }

export interface TaintedValue { value: string; trust: TrustTier }

/** Gate an egress/tool call: every argument's combined trust must meet the sink's required minimum. */
export function gateEgress(args: TaintedValue[], sink: { requires: TrustTier }): { allowed: boolean; combined: TrustTier; reason: string } {
  const combined = deriveTrust(args.map((a) => a.trust))
  const allowed = RANK[combined] >= RANK[sink.requires]
  return {
    allowed,
    combined,
    reason: allowed ? 'ok' : `egress requires '${sink.requires}' but arguments derive to '${combined}'`,
  }
}

/** A value computed from inputs inherits the weakest input's trust (taint propagation). */
export function deriveValueTrust(value: string, inputs: TaintedValue[]): TaintedValue {
  return { value, trust: deriveTrust(inputs.map((i) => i.trust)) }
}
