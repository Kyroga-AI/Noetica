// canon-route — the DETERMINISTIC pre-processor (the "don't generate for routing/calc QA" move). Given a
// question, classify and ground it from the TYPED canon with NO LLM call for the routing decision itself:
//   • entities       via canonEntities       (the question's canon terms)
//   • set membership via canonAncestors       (lexical-closure genus families — DEDUCED, discrete; the
//                                              embedding manifold is continuous and won't cluster, so clean
//                                              inclusion/exclusion lives here, not in vector clusters)
//   • equations      via canonFormulas        (the equation cards — INDUCED)
//   • route ∈ {calc, define, retrieve, reason} from entity types + question shape, deterministic
// Plus canonLookup(term, kind): the on-demand "spelling-bee" tool the model can call mid-reasoning
// (define X / formula for X / what is X a kind of) — answered from the canon. Smart, not cheating: it's a
// lookup over deduced/induced facts, no extra generation.
import { canonEntities, canonDef, canonFormulas, canonBridges, canonAncestors, type CanonEntity } from './canon-lookup.js'

const NUMERIC = /\b\d|\bcalculate\b|\bcompute\b|\bfind the\b|\bhow (much|many|fast|far|long)\b|\bwhat is the (value|magnitude|rate|speed|energy|force|pressure|concentration|probability)\b|=\s*\?/i
const DEFINE = /^\s*(what (is|are)|define|describe|explain what)\b|which of the following (is|best describes|defines|are)\b/i

export type Route = 'calc' | 'define' | 'retrieve' | 'reason'
export interface RouteDecision {
  route: Route
  deterministic: boolean              // true = the route is answerable from the canon WITHOUT generation
  entities: string[]
  genus: string[]                     // lexical-closure families the entities belong to (set membership)
  equations: Array<{ name: string; form: string }>
  grounding: string                   // canon context to inject (defs + equations + genus chain)
}

/** Route a question off the typed canon — no generation for the decision. */
export function canonRoute(question: string): RouteDecision {
  const ents: CanonEntity[] = canonEntities(question, 8)
  const equations: Array<{ name: string; form: string }> = []
  const genus = new Set<string>()
  const seenEq = new Set<string>()
  for (const e of ents) {
    for (const a of canonAncestors(e.term)) genus.add(a)
    for (const eq of canonFormulas(e.domain, e.topic)) { if (!seenEq.has(eq.name)) { seenEq.add(eq.name); equations.push(eq) } }
  }
  const numeric = NUMERIC.test(question)
  const define = DEFINE.test(question)
  let route: Route
  if (numeric && equations.length) route = 'calc'        // known equation + numeric → compute deterministically (sympy)
  else if (define && ents.length) route = 'define'       // "what is X" + canon def → answer deterministically
  else if (ents.length) route = 'retrieve'               // grounded retrieval over the entities' topics
  else route = 'reason'                                  // nothing in canon → hand to the model
  const deterministic = route === 'calc' || route === 'define'
  const defs = ents.slice(0, 4).map((e) => `- ${e.term}: ${(canonDef(e.term) ?? '').slice(0, 160)}`).join('\n')
  const eqs = equations.slice(0, 6).map((e) => `- ${e.name}:  ${e.form}`).join('\n')
  const grounding = [
    ents.length ? `Definitions:\n${defs}` : '',
    equations.length ? `Equations/models:\n${eqs}` : '',
    genus.size ? `Is-a (genus): ${[...genus].slice(0, 6).join(', ')}` : '',
  ].filter(Boolean).join('\n\n')
  return { route, deterministic, entities: ents.map((e) => e.term), genus: [...genus], equations, grounding }
}

export type LookupKind = 'definition' | 'formula' | 'genus' | 'related'

/** The spelling-bee tool: answer a model's on-demand request from the canon (no generation). */
export function canonLookup(term: string, kind: LookupKind = 'definition'): string | null {
  switch (kind) {
    case 'definition':
      return canonDef(term)
    case 'genus': {
      const a = canonAncestors(term)
      return a.length ? `${term} is a kind of ${a.join(' → ')}` : null
    }
    case 'related': {
      const b = canonBridges(term)
      return b.length ? b.join(', ') : null
    }
    case 'formula': {
      const e = canonEntities(term, 1)[0]
      if (!e) return null
      const eqs = canonFormulas(e.domain, e.topic)
      return eqs.length ? eqs.map((x) => `${x.name}: ${x.form}`).join('\n') : null
    }
    default:
      return null
  }
}

// CLI self-test:  npx tsx lib/canon-route.ts "Calculate the kinetic energy of a 2 kg mass moving at 3 m/s"
if (process.argv[1] && process.argv[1].endsWith('canon-route.ts')) {
  for (const q of [
    process.argv.slice(2).join(' ') || 'Calculate the angular momentum of a wheel given its moment of inertia and angular velocity',
    'What is the central limit theorem?',
    'Why did the chicken cross the road',
  ]) {
    const r = canonRoute(q)
    console.log(`\nQ: ${q}\n  route=${r.route}  deterministic=${r.deterministic}  entities=[${r.entities.join(', ')}]  genus=[${r.genus.join(', ')}]`)
    if (r.equations.length) console.log(`  equations: ${r.equations.slice(0, 3).map((e) => e.name).join(' · ')}`)
  }
  console.log('\nspelling-bee lookups:')
  console.log('  define torque →', canonLookup('torque', 'definition')?.slice(0, 70))
  console.log('  genus angular momentum →', canonLookup('angular momentum', 'genus'))
}
