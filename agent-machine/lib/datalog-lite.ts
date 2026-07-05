/**
 * datalog-lite.ts — recursive rule evaluation with stratified negation (the Cozo/Datalog role). Beyond a
 * single transitive shape: conjunctive rules with variable joins, recursion to a fixpoint, and negation-as-
 * failure ("authorized UNLESS a revocation was derived"). Variables are Uppercase, constants lowercase.
 */
export interface Atom { pred: string; terms: string[]; neg?: boolean }
export interface Rule { head: Atom; body: Atom[] }
export interface Fact { pred: string; args: string[] }

// Bindings are keyed by query variable names (isVar allows leading '_'/caps, so a
// crafted name like "constructor"/"__proto__" is possible) → use a Map, not a
// plain object, to keep those off Object.prototype (js/remote-property-injection).
type Binding = Map<string, string>
const isVar = (t: string) => /^[A-Z_]/.test(t)
const factKey = (f: Fact) => `${f.pred}(${f.args.join(',')})`

function matchAtom(atom: Atom, facts: Fact[], binding: Binding): Binding[] {
  const out: Binding[] = []
  for (const f of facts) {
    if (f.pred !== atom.pred || f.args.length !== atom.terms.length) continue
    const b: Binding = new Map(binding)
    let ok = true
    for (let i = 0; i < atom.terms.length; i++) {
      const t = atom.terms[i]!
      if (isVar(t)) { const bound = b.get(t); if (bound !== undefined && bound !== f.args[i]) { ok = false; break } b.set(t, f.args[i]!) }
      else if (t !== f.args[i]) { ok = false; break }
    }
    if (ok) out.push(b)
  }
  return out
}

function fireRule(rule: Rule, facts: Fact[]): Fact[] {
  let bindings: Binding[] = [new Map()]
  for (const atom of rule.body) {
    if (atom.neg) bindings = bindings.filter((b) => matchAtom(atom, facts, b).length === 0)   // negation-as-failure
    else bindings = bindings.flatMap((b) => matchAtom(atom, facts, b))
  }
  return bindings.map((b) => ({ pred: rule.head.pred, args: rule.head.terms.map((t) => (isVar(t) ? b.get(t)! : t)) }))
}

/** Semi-naive fixpoint evaluation. Returns all facts (base + derived). */
export function evaluate(facts: Fact[], rules: Rule[], opts: { maxIter?: number } = {}): Fact[] {
  const maxIter = opts.maxIter ?? 100
  const all = [...facts]
  const seen = new Set(all.map(factKey))
  for (let iter = 0; iter < maxIter; iter++) {
    let added = false
    for (const r of rules) {
      for (const nf of fireRule(r, all)) {
        const k = factKey(nf)
        if (!seen.has(k)) { seen.add(k); all.push(nf); added = true }
      }
    }
    if (!added) break
  }
  return all
}
