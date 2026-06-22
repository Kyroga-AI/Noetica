/**
 * graph-infer.ts — rule-based inference over the graph (OWL-lite), with verification.
 *
 * Semantic graph platforms (Stardog, Ontotext) derive new facts via reasoning — transitivity,
 * subsumption, inverses. We add a lightweight version over relational claims: if A depends-on B and B
 * depends-on C, infer A depends-on C. Every inferred fact is marked epistemic: 'inferred' (it's derived,
 * not extracted) and carries its derivation chain — and, uniquely, can be run through the verifier so a
 * bad inference is flagged. Rule-based derivation + verification: Stardog reasons, GraphRAG doesn't; we
 * reason AND check.
 */

import { generateOllamaText } from './ollama.js'

export interface InferredFact {
  subject: string
  predicate: string
  object: string
  via: string                      // derivation chain, e.g. "A → B → C (transitive 'depends on')"
  rule: 'transitivity'
  epistemic: 'inferred'
  verified?: boolean
  confidence?: number
}

// Predicate families that are typically transitive (substring match against the relation type/text).
const TRANSITIVE = ['depend', 'part of', 'part-of', 'partof', 'compos', 'contain', 'requir', 'use', 'subclass', 'subtype', 'is a', 'is-a', 'hierarch', 'delegat', 'located', 'belongs']
function isTransitive(p: string): boolean { const l = p.toLowerCase(); return TRANSITIVE.some((t) => l.includes(t)) }

function safeJson(s: string): { holds?: boolean; confidence?: number } | null {
  const m = s.match(/\{[\s\S]*\}/); if (!m) return null
  try { return JSON.parse(m[0]) } catch { return null }
}

/** Derive new facts by transitivity over relational facts, then (optionally) verify each. */
export async function inferFacts(facts: Array<{ subject: string; predicate: string; object: string }>, opts: { model?: string; verify?: boolean; max?: number } = {}): Promise<InferredFact[]> {
  const norm = (s: string) => s.trim().toLowerCase()
  const existing = new Set(facts.map((f) => `${norm(f.subject)}|${norm(f.predicate)}|${norm(f.object)}`))

  // Group transitive facts by predicate and build per-predicate adjacency (subject → objects).
  const byPred = new Map<string, Map<string, Set<string>>>()
  for (const f of facts) {
    if (!f.subject || !f.object || f.subject === f.object || !isTransitive(f.predicate)) continue
    const p = f.predicate
    const adj = byPred.get(p) ?? new Map<string, Set<string>>()
    ;(adj.get(f.subject) ?? adj.set(f.subject, new Set()).get(f.subject)!).add(f.object)
    byPred.set(p, adj)
  }

  const inferred: InferredFact[] = []
  for (const [pred, adj] of byPred) {
    for (const [s, objs] of adj) {
      for (const mid of objs) {
        for (const o2 of adj.get(mid) ?? []) {
          if (o2 === s) continue
          const key = `${norm(s)}|${norm(pred)}|${norm(o2)}`
          if (existing.has(key)) continue
          existing.add(key)
          inferred.push({ subject: s, predicate: pred, object: o2, via: `${s} → ${mid} → ${o2} (transitive '${pred}')`, rule: 'transitivity', epistemic: 'inferred' })
        }
      }
    }
  }
  inferred.sort((a, b) => a.subject.localeCompare(b.subject))
  const capped = inferred.slice(0, opts.max ?? 30)

  // Verify: does the conclusion necessarily follow from the (assumed-true) premises?
  if (opts.verify && opts.model) {
    for (const f of capped) {
      const prompt = `Given these relations hold, ${f.via}.\n\nDoes it necessarily follow that "${f.subject}" ${f.predicate} "${f.object}"? Consider whether this relation is genuinely transitive. STRICT JSON only:\n{"holds": true|false, "confidence": 0.0-1.0}`
      try {
        const { content } = await generateOllamaText({ model: opts.model, messages: [{ role: 'user', content: prompt }], temperature: 0.1, numCtx: 2048 })
        const j = safeJson(content)
        f.verified = !!j?.holds
        if (typeof j?.confidence === 'number') f.confidence = Number(Math.max(0, Math.min(1, j.confidence)).toFixed(2))
      } catch { f.verified = false }
    }
  }
  return capped
}
