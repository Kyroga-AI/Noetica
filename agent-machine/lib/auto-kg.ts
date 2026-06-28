/**
 * auto-kg.ts — auto-extract a knowledge graph (entity→relation→entity triples) from arbitrary user documents.
 *
 * The peer-parity gap: RAGFlow / GraphRAG / LightRAG auto-build a KG from uploaded docs; Noetica's graph only
 * grew via the frontier-authored canon + interaction logging, so user docs added vector chunks but no entities
 * or relations — capping graph-hop retrieval on user content.
 *
 * THE GOVERNANCE TWIST (the differentiator): extracted triples become PENDING `GraphProposal`s, NOT canonical
 * edges. They are segmented from the frontier-authored canon (which is verified, authoritative) and only enter
 * the graph through the existing review/writeback path (persistProposals). Auto-extraction is a SUGGESTION
 * surface, never an authority — so a hallucinated relation can't silently corrupt the canon.
 *
 * Split model-agnostic: `extractTriplesPrompt` + the DETERMINISTIC `parseTriples` (robust JSON-from-noise +
 * validation + dedupe) are pure and tested; `extractKnowledgeGraph` takes a `generate` fn so the model is
 * injectable (Ollama in prod, a stub in tests).
 */

import { proposalsFromInferred } from './graph-proposals.js'
import type { GraphProposal } from './graph-proposals.js'

export interface KgTriple { subject: string; predicate: string; object: string }

/** The extraction prompt: ask for a strict JSON array of {subject,predicate,object}. */
export function extractTriplesPrompt(text: string, maxTriples = 20): string {
  return `Extract the key factual relationships from the text below as a JSON array of triples.
Each triple is {"subject": "...", "predicate": "...", "object": "..."} — short noun-phrase subject/object and a
concise verb/relation predicate. Only relationships STATED in the text (never inferred or world-knowledge).
At most ${maxTriples}. Return ONLY the JSON array, no prose.

TEXT:
${text.slice(0, 6000)}

JSON:`
}

const clean = (s: unknown): string => (typeof s === 'string' ? s.trim().replace(/\s+/g, ' ') : '')

/**
 * DETERMINISTIC parse of a model's reply into validated triples. Robust to code fences / leading prose: it
 * extracts the first top-level JSON array, validates each element has non-empty string subject/predicate/object,
 * trims + collapses whitespace, drops self-loops, and dedupes case-insensitively. Returns [] on anything unusable
 * (never throws) — a parse failure must not corrupt the graph.
 */
export function parseTriples(modelOutput: string, opts: { max?: number } = {}): KgTriple[] {
  const max = opts.max ?? 50
  if (!modelOutput) return []
  const start = modelOutput.indexOf('[')
  const end = modelOutput.lastIndexOf(']')
  if (start < 0 || end <= start) return []
  let arr: unknown
  try { arr = JSON.parse(modelOutput.slice(start, end + 1)) } catch { return [] }
  if (!Array.isArray(arr)) return []
  const seen = new Set<string>()
  const out: KgTriple[] = []
  for (const el of arr) {
    if (!el || typeof el !== 'object') continue
    const r = el as Record<string, unknown>
    const subject = clean(r['subject'] ?? r['s'])
    const predicate = clean(r['predicate'] ?? r['p'] ?? r['relation'])
    const object = clean(r['object'] ?? r['o'])
    if (!subject || !predicate || !object) continue
    if (subject.toLowerCase() === object.toLowerCase()) continue   // self-loop = no information
    const key = `${subject}|${predicate}|${object}`.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ subject, predicate, object })
    if (out.length >= max) break
  }
  return out
}

/** Triples → PENDING graph proposals (add-edge), tagged with the document source. Governance: NOT canonical. */
export function triplesToProposals(triples: KgTriple[], source: string): GraphProposal[] {
  // proposalsFromInferred builds add-edge proposals (status:'pending'); mark the source as the user doc so
  // review/provenance shows these came from auto-extraction, never the authored canon.
  return proposalsFromInferred(triples.map((t) => ({ ...t, via: source }))).map((p) => ({ ...p, source: `auto-kg:${source}` }))
}

export interface AutoKgResult { triples: KgTriple[]; proposals: GraphProposal[] }

/**
 * Model-agnostic: extract a KG from `text` into pending proposals. `generate` returns the model's raw reply.
 * Returns both the parsed triples and the proposals (the caller decides whether to persistProposals).
 */
export async function extractKnowledgeGraph(
  text: string,
  source: string,
  generate: (prompt: string) => Promise<string>,
  opts: { maxTriples?: number } = {},
): Promise<AutoKgResult> {
  if (!text || !text.trim()) return { triples: [], proposals: [] }
  let raw = ''
  try { raw = await generate(extractTriplesPrompt(text, opts.maxTriples ?? 20)) } catch { return { triples: [], proposals: [] } }
  const triples = parseTriples(raw, { max: opts.maxTriples ?? 20 })
  return { triples, proposals: triplesToProposals(triples, source) }
}
