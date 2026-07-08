/**
 * PLN-backed grounding for Value Judgment. Where the base VJ checks token overlap
 * with the retrieved snippet, this checks the answer's claim entities against the
 * ENTIRE persistent knowledge graph — including PLN-derived (transitive)
 * relations — and reports which claims are grounded in known knowledge (with
 * TruthValue confidence) versus novel/ungrounded. Symbolic entailment over the
 * AtomSpace, complementing the neural output.
 *
 * Pure scoring is dependency-free and unit-tested; the graph lookup wraps it.
 */

import { getGraph } from './graph.js'
import { forwardChain } from '@socioprophet/hellgraph'

const STOP = new Set([
  'The','This','That','These','Those','When','Where','While','With','From','Into',
  'And','But','For','You','Your','They','Their','What','Which','Here','There','It',
  // Sentence-initial gerunds/status filler — common in acknowledgement/progress text
  // ("Running it right now…", "Searching for…", "Checking on…") which are not claims.
  'Running','Working','Loading','Searching','Checking','Looking','Trying','Processing',
  'Generating','Building','Fetching','Gathering','Composing','Waiting','Analyzing',
  'Reviewing','Let','Also','Now','Please','Sure','Okay','Note',
])

// Extract candidate claim entities: Capitalized words/phrases and "quoted" terms.
export function extractClaimEntities(text: string): string[] {
  const out = new Set<string>()
  // Quoted phrases
  for (const m of text.matchAll(/"([^"]{2,40})"/g)) out.add(m[1]!.trim())
  // Capitalized sequences (proper-noun-ish), skipping sentence-initial stopwords
  for (const m of text.matchAll(/\b([A-Z][a-zA-Z0-9.+-]{2,}(?:\s+[A-Z][a-zA-Z0-9.+-]{2,}){0,3})\b/g)) {
    const phrase = m[1]!.trim()
    const first = phrase.split(/\s+/)[0]!
    if (STOP.has(first) && !phrase.includes(' ')) continue
    out.add(phrase)
  }
  return [...out].slice(0, 25)
}

export interface GraphGrounding {
  graphGrounding: number   // 0..1, confidence-weighted fraction of claims known to the graph
  grounded: string[]
  novel: string[]
}

// Pure: score claims against a lookup that says whether each is known + its confidence.
export function scoreGraphGrounding(
  entities: string[],
  lookup: (e: string) => { found: boolean; confidence: number },
): GraphGrounding {
  if (entities.length === 0) return { graphGrounding: 0, grounded: [], novel: [] }
  const grounded: string[] = []
  const novel: string[] = []
  let confSum = 0
  for (const e of entities) {
    const r = lookup(e)
    if (r.found) { grounded.push(e); confSum += Math.max(0, Math.min(1, r.confidence)) }
    else novel.push(e)
  }
  return {
    graphGrounding: Number((confSum / entities.length).toFixed(3)),
    grounded,
    novel,
  }
}

// Impure: assess an answer against the live graph, optionally running a bounded
// PLN forward-chain first so transitively-related entities count as grounded.
export function assessAgainstGraph(answerText: string, opts?: { runPln?: boolean }): GraphGrounding {
  const entities = extractClaimEntities(answerText)
  if (entities.length === 0) return { graphGrounding: 0, grounded: [], novel: [] }

  if (opts?.runPln) {
    try { forwardChain({ maxIters: 2 }) } catch { /* PLN best-effort */ }
  }

  const g = getGraph()
  // Build a normalized index of known FeatureAtoms → confidence.
  const known = new Map<string, number>()
  for (const n of g.allNodes()) {
    if (!n.labels.includes('FeatureAtom')) continue
    const surface = String(n.properties['normalised'] ?? n.properties['surface'] ?? n.id).toLowerCase()
    if (surface.length < 3) continue
    const conf = Number(n.properties['confidence'] ?? 0.5)
    known.set(surface, Math.max(known.get(surface) ?? 0, conf))
  }

  return scoreGraphGrounding(entities, (e) => {
    const key = e.toLowerCase()
    // exact or containment match against known atom surfaces
    if (known.has(key)) return { found: true, confidence: known.get(key)! }
    for (const [surface, conf] of known) {
      if (surface.includes(key) || key.includes(surface)) return { found: true, confidence: conf }
    }
    return { found: false, confidence: 0 }
  })
}
