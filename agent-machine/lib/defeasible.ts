/**
 * defeasible.ts — defeasible reasoning with rule priorities + retraction. Monotonic closure can only ADD
 * facts; defeasible logic resolves CONFLICTING rules ("birds fly" defeated by "penguins don't fly" when
 * penguin>bird) and RETRACTS the weaker conclusion. Strict rules beat defeasible; else the superiority
 * relation decides; unresolved conflicts conclude neither (skeptical semantics).
 */
export interface DefRule { id: string; antecedent: string[]; consequent: string; strict?: boolean }
export interface Superiority { winner: string; loser: string }   // rule id beats rule id

const negate = (atom: string) => (atom.startsWith('!') ? atom.slice(1) : `!${atom}`)

export function deriveDefeasible(facts: string[], rules: DefRule[], superiority: Superiority[] = []): { conclusions: string[]; retracted: string[] } {
  const known = new Set(facts)
  const beats = (a: string, b: string) => superiority.some((s) => s.winner === a && s.loser === b)
  const retracted = new Set<string>()

  // Fixpoint: keep firing applicable rules, resolving conflicts each round, until stable.
  for (let pass = 0; pass < 64; pass++) {
    const fired = rules.filter((r) => r.antecedent.every((a) => known.has(a)))
    let changed = false
    // group fired rules by the atom they conclude (consequent or its negation)
    for (const r of fired) {
      const c = r.consequent
      if (known.has(c)) continue
      const opp = negate(c)
      const opposers = fired.filter((o) => o.consequent === opp)
      if (opposers.length === 0) { known.add(c); changed = true; continue }
      // conflict: does r defeat ALL opposers? strict beats defeasible; else superiority must beat each.
      const winsAll = opposers.every((o) => (r.strict && !o.strict) || beats(r.id, o.id))
      const losesAny = opposers.some((o) => (o.strict && !r.strict) || beats(o.id, r.id))
      if (winsAll && !losesAny) { known.add(c); retracted.add(opp); changed = true }
      // otherwise unresolved → conclude neither this pass
    }
    if (!changed) break
  }
  return { conclusions: [...known], retracted: [...retracted] }
}
