/**
 * provenance.ts — why-provenance / proof trees over derived facts (#1 KR keystone).
 * For any derived conclusion, emit the minimal set of base facts + rule applications that justify it —
 * auditable, replayable, the substrate for the sovereignty attestation lane. Bounded-recursion safe.
 */
export interface Derivation { rule: string; premises: string[] }   // fact ← rule(premises)
export interface ProofNode { fact: string; rule?: string; children: ProofNode[] }

/** Build the proof tree for `fact` from a map of derivations (absent ⇒ base fact / leaf). Cycle-guarded. */
export function buildProof(fact: string, derivations: Map<string, Derivation>, seen: Set<string> = new Set()): ProofNode {
  if (seen.has(fact)) return { fact, children: [] }
  seen.add(fact)
  const d = derivations.get(fact)
  if (!d) return { fact, children: [] }
  return { fact, rule: d.rule, children: d.premises.map((p) => buildProof(p, derivations, new Set(seen))) }
}

/** The minimal set of base facts (leaves) the conclusion rests on. */
export function baseFacts(proof: ProofNode): string[] {
  if (proof.children.length === 0) return [proof.fact]
  return [...new Set(proof.children.flatMap(baseFacts))]
}

/** Rules used anywhere in the derivation. */
export function rulesUsed(proof: ProofNode): string[] {
  const out = proof.rule ? [proof.rule] : []
  return [...new Set([...out, ...proof.children.flatMap(rulesUsed)])]
}

/** Human-readable indented proof. */
export function explainProof(proof: ProofNode, depth = 0): string {
  const pad = '  '.repeat(depth)
  const head = proof.rule ? `${proof.fact}  ⟵ ${proof.rule}` : `${proof.fact}  (base fact)`
  return [pad + head, ...proof.children.map((c) => explainProof(c, depth + 1))].join('\n')
}
