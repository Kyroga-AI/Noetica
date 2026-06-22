/**
 * rule-mining.ts — automatic Horn-rule mining from the graph (AnyBURL/AMIE-style). DISCOVERS multi-hop rule
 * shapes with confidence — p1(x,y) ∧ p2(y,z) ⇒ p3(x,z) — instead of hand-authoring the single transitive
 * shape. Mined rules predict plausible missing edges, each with a reliability score.
 */
export interface Triple { s: string; p: string; o: string }
export interface MinedRule { body: [string, string]; head: string; confidence: number; support: number }

/**
 * Mine length-2 path rules. For every observed path x —p1→ y —p2→ z, the "body" (p1,p2) is a candidate;
 * its head is whatever predicate p3 directly connects x→z. confidence = support / bodyCount.
 */
export function mineRules(triples: Triple[], opts: { minConfidence?: number; minSupport?: number } = {}): MinedRule[] {
  const minConfidence = opts.minConfidence ?? 0.5
  const minSupport = opts.minSupport ?? 2
  const outAdj = new Map<string, Array<{ p: string; o: string }>>()   // s → edges
  const direct = new Set<string>()                                     // "s|p|o"
  for (const t of triples) {
    ;(outAdj.get(t.s) ?? outAdj.set(t.s, []).get(t.s)!).push({ p: t.p, o: t.o })
    direct.add(`${t.s}|${t.p}|${t.o}`)
  }
  // bodyCount[(p1,p2)] = # of x..z paths; support[(p1,p2,p3)] = # of those where x-p3->z exists
  const bodyCount = new Map<string, number>()
  const headCount = new Map<string, number>()
  for (const [x, e1s] of outAdj) {
    for (const e1 of e1s) {
      const e2s = outAdj.get(e1.o) ?? []
      for (const e2 of e2s) {
        const z = e2.o
        if (z === x) continue
        const bodyKey = `${e1.p}|${e2.p}`
        bodyCount.set(bodyKey, (bodyCount.get(bodyKey) ?? 0) + 1)
        // which direct predicates connect x→z?
        for (const e of (outAdj.get(x) ?? [])) if (e.o === z) {
          const hk = `${bodyKey}|${e.p}`
          headCount.set(hk, (headCount.get(hk) ?? 0) + 1)
        }
      }
    }
  }
  const rules: MinedRule[] = []
  for (const [hk, support] of headCount) {
    const [p1, p2, p3] = hk.split('|')
    const body = bodyCount.get(`${p1}|${p2}`) ?? support
    const confidence = support / body
    if (support >= minSupport && confidence >= minConfidence) rules.push({ body: [p1!, p2!], head: p3!, confidence: Number(confidence.toFixed(3)), support })
  }
  return rules.sort((a, b) => b.confidence - a.confidence || b.support - a.support)
}
