/**
 * graph-rag.ts — GraphRAG over HellGraph: community summarization + global sensemaking.
 *
 * Per-node retrieval answers "what do I know about X". It cannot answer "what are the THEMES across
 * everything I know" — that needs structure. Microsoft's GraphRAG pattern: detect communities (we use
 * Louvain, see graph-analytics.ts) → have an LLM write a report for each → answer global questions by
 * map-reduce over the reports (partial answer per relevant community, then synthesize).
 *
 * Beyond the published pattern, every community report and every global answer is run through the
 * grounding verifier (research-verify.ts) and carries a TRUST score — so a confidently-wrong summary
 * is flagged, not trusted. Structural communities + local-LLM summaries + a verifier is a combination
 * none of the incumbent graph platforms ship.
 */

import { generateOllamaText } from './ollama.js'
import { verifyGrounding } from './research-verify.js'
import { lexicalSearch, semanticSearch } from './doc-store.js'
import type { GraphAnalytics } from './graph-analytics.js'

/** A first-class, individually grounding-verified claim — GraphRAG extracts claims; we verify each. */
export interface VerifiedClaim { text: string; grounded: boolean; score: number }

export interface CommunityReport {
  id: number
  size: number
  title: string
  summary: string
  claims: VerifiedClaim[]   // each claim carries its own grounding verdict, not just the report
  trust: number             // overall grounding score 0..1 (summary + claims vs the community's evidence)
  grounded: boolean
  topNodes: string[]        // readable labels of the central members
  members: string[]         // readable labels (capped)
}

export interface GlobalAnswer {
  answer: string
  trust: number
  grounded: boolean
  communitiesUsed: Array<{ id: number; title: string; relevance: number }>
  localUsed: number   // # of local entity-level passages blended in (DRIFT-style hybrid)
  sources: string[]   // document filenames the answer drew from (provenance / citations)
}

const STOP = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'from', 'what', 'which', 'are', 'how', 'does', 'about'])
function tokens(s: string): Set<string> {
  return new Set(s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((t) => t.length > 2 && !STOP.has(t)))
}
function safeJson(s: string): { title?: string; summary?: string; claims?: string[] } | null {
  const m = s.match(/\{[\s\S]*\}/)
  if (!m) return null
  try { return JSON.parse(m[0]) } catch { return null }
}

/** Build one LLM report per community, grounded + trust-scored against the community's evidence. */
export async function buildCommunityReports(
  analytics: GraphAnalytics,
  labelOf: (id: string) => string,
  opts: { model: string; maxCommunities?: number; minSize?: number; level?: 'coarse' | 'fine'; persona?: string },
): Promise<CommunityReport[]> {
  const personaPrefix = opts.persona ? `${opts.persona}\n\n` : ''
  // Hierarchical: 'coarse' = top-level themes, 'fine' = sub-themes (falls back to coarse if no hierarchy).
  const source = opts.level === 'fine' && analytics.subdivisions.length ? analytics.subdivisions : analytics.communities
  const comms = source
    .filter((c) => c.size >= (opts.minSize ?? 3))
    .slice(0, opts.maxCommunities ?? 24)

  const reports: CommunityReport[] = []
  for (const c of comms) {
    const memberLabels = [...new Set(c.members.map(labelOf).filter((l): l is string => Boolean(l)))]
    const topLabels = [...new Set(c.topNodes.map(labelOf).filter((l): l is string => Boolean(l)))]
    if (topLabels.length === 0) continue

    // Evidence: pull the community's central concepts out of the document store.
    const probe = topLabels.slice(0, 8).join(' ')
    let chunks = lexicalSearch(probe, 8)
    if (chunks.length < 3) { try { chunks = [...chunks, ...(await semanticSearch(probe, 6))] } catch { /* search best-effort */ } }
    const evidence = [...new Set(chunks.map((ch) => ch.text))].slice(0, 10)
    const corpus = evidence.join('\n---\n').slice(0, 6000)

    const prompt = `${personaPrefix}You are analyzing one cluster of related concepts from a personal knowledge graph.

Concepts in this cluster (most central first): ${topLabels.slice(0, 12).join(', ')}${memberLabels.length > 12 ? ` (+${memberLabels.length - 12} more)` : ''}

Supporting evidence from the user's own documents:
${corpus || '(no document text available — infer cautiously from the concept names alone)'}

Write a community report as STRICT JSON, no prose outside the JSON:
{"title": "<a 3-6 word theme>", "summary": "<2-3 sentences synthesizing what this cluster is about>", "claims": ["<a key factual claim grounded in the evidence>", "...up to 4"]}
Base the summary and claims ONLY on the concepts and evidence above. Do not invent facts.`

    let parsed: { title?: string; summary?: string; claims?: string[] } | null = null
    try {
      const { content } = await generateOllamaText({ model: opts.model, messages: [{ role: 'user', content: prompt }], temperature: 0.2, numCtx: 8192 })
      parsed = safeJson(content)
    } catch { /* model best-effort — fall back below */ }

    const title = (parsed?.title || topLabels.slice(0, 3).join(' / ')).slice(0, 80)
    const summary = (parsed?.summary || '').slice(0, 600)
    const claimStrings = (parsed?.claims || []).filter((x) => typeof x === 'string').slice(0, 4)
    const ev = evidence.map((t) => ({ text: t }))

    // Verify EACH claim against the community's evidence (deterministic grounding — no extra LLM cost),
    // so an ungrounded claim is flagged individually, not hidden inside a report-level average.
    const claims: VerifiedClaim[] = claimStrings.map((text) => {
      const cg = ev.length ? verifyGrounding(text, ev, 0.5, 0.5) : { grounded: false, score: 0 }
      return { text, grounded: cg.grounded, score: Number(cg.score.toFixed(2)) }
    })

    // Report-level grounding: summary + claims vs the evidence.
    const verifyText = [summary, ...claimStrings].join(' ')
    const g = ev.length && verifyText.trim()
      ? verifyGrounding(verifyText, ev)
      : { grounded: false, score: 0, supported: 0, total: 0, unsupported: [] as string[] }

    reports.push({
      id: c.id, size: c.size, title, summary, claims,
      trust: Number(g.score.toFixed(2)), grounded: g.grounded,
      topNodes: topLabels.slice(0, 6), members: memberLabels.slice(0, 40),
    })
  }
  return reports
}

/** Global sensemaking: map a question over relevant community reports, reduce to one grounded answer. */
export async function globalSearch(question: string, reports: CommunityReport[], opts: { model: string; maxCommunities?: number; local?: boolean; relevanceOf?: (r: CommunityReport) => number }): Promise<GlobalAnswer> {
  const qTok = tokens(question)
  // Report relevance: a caller can pass an embedding-based scorer (semantic, GraphRAG's "embed reports");
  // otherwise fall back to token overlap.
  const relevance = opts.relevanceOf ?? ((r: CommunityReport): number => {
    const rTok = tokens(`${r.title} ${r.summary} ${r.claims.map((c) => c.text).join(' ')} ${r.topNodes.join(' ')}`)
    let overlap = 0; for (const t of qTok) if (rTok.has(t)) overlap++
    return qTok.size ? overlap / qTok.size : 0
  })
  const scored = reports.map((r) => ({ r, rel: relevance(r) })).sort((a, b) => b.rel - a.rel)
  const relevant = scored.filter((s) => s.rel > 0).slice(0, opts.maxCommunities ?? 6)
  if (relevant.length === 0) relevant.push(...scored.slice(0, 3))   // nothing matched → broadest communities

  // MAP — a partial answer from each relevant community report.
  const partials: Array<{ id: number; title: string; text: string }> = []
  for (const { r } of relevant) {
    const prompt = `Community report "${r.title}": ${r.summary}\nKey points: ${r.claims.map((c) => c.text).join('; ') || '(none)'}\n\nQuestion: ${question}\n\nIf this community is relevant to the question, answer in 1-2 sentences using ONLY this report. If it is not relevant, reply exactly: NOT RELEVANT`
    try {
      const { content } = await generateOllamaText({ model: opts.model, messages: [{ role: 'user', content: prompt }], temperature: 0.2 })
      const txt = content.trim()
      if (txt && !/NOT RELEVANT/i.test(txt)) partials.push({ id: r.id, title: r.title, text: txt })
    } catch { /* skip this community */ }
  }

  // DRIFT-style hybrid: blend the GLOBAL community themes (partials) with LOCAL entity-level evidence —
  // specific passages from the doc store matching the question. Global gives sensemaking; local gives
  // the specifics. The final answer is grounded against both.
  let local: string[] = []
  let _sources: string[] = []
  if (opts.local !== false) {
    try { const lh = lexicalSearch(question, 6); local = [...new Set(lh.map((h) => h.text))].slice(0, 5); _sources = [...new Set(lh.map((h) => h.filename).filter(Boolean))].slice(0, 5) } catch { /* local best-effort */ }
  }

  if (partials.length === 0 && local.length === 0) {
    return { answer: "I don't have enough in the knowledge graph to answer that.", trust: 0, grounded: false, communitiesUsed: [], localUsed: 0, sources: [] }
  }

  // REDUCE — synthesize global themes + local passages into one grounded answer.
  const globalBlock = partials.length ? `GLOBAL — themes across your knowledge graph:\n${partials.map((p) => `[${p.title}] ${p.text}`).join('\n')}` : ''
  const localBlock = local.length ? `LOCAL — specific passages:\n${local.map((t, i) => `(${i + 1}) ${t.slice(0, 300)}`).join('\n')}` : ''
  const reducePrompt = `Question: ${question}\n\n${[globalBlock, localBlock].filter(Boolean).join('\n\n')}\n\nSynthesize a single coherent answer grounded ONLY in the material above (global themes + local passages). Be concise and concrete; do not add facts not present above.`
  let answer = ''
  try { const { content } = await generateOllamaText({ model: opts.model, messages: [{ role: 'user', content: reducePrompt }], temperature: 0.3 }); answer = content.trim() } catch { answer = partials.map((p) => p.text).join(' ') || local.join(' ') }

  // Grounding of the final answer against BOTH global partials and local passages.
  const g = verifyGrounding(answer, [...partials.map((p) => ({ text: p.text })), ...local.map((t) => ({ text: t }))])
  return {
    answer,
    trust: Number(g.score.toFixed(2)),
    grounded: g.grounded,
    communitiesUsed: partials.map((p) => { const s = scored.find((x) => x.r.id === p.id); return { id: p.id, title: p.title, relevance: Number((s?.rel ?? 0).toFixed(2)) } }),
    localUsed: local.length,
    sources: _sources,
  }
}

export interface DriftAnswer extends GlobalAnswer { followups: string[]; rounds: number }

function safeStrArr(s: string): string[] {
  const m = s.match(/\[[\s\S]*\]/); if (!m) return []
  try { const v = JSON.parse(m[0]); return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [] } catch { return [] }
}

/** DRIFT — iterative fan-out: answer (hybrid global+local), generate follow-up sub-questions from the
 *  draft, fan out to gather more local evidence, then refine. Multi-step reasoning vs a single pass. */
export async function driftSearch(question: string, reports: CommunityReport[], opts: { model: string; maxCommunities?: number; relevanceOf?: (r: CommunityReport) => number }): Promise<DriftAnswer> {
  const base = await globalSearch(question, reports, opts)
  if (!base.answer || (base.communitiesUsed.length === 0 && base.localUsed === 0)) return { ...base, followups: [], rounds: 0 }

  // 1. Follow-up sub-questions implied by the draft answer.
  let followups: string[] = []
  try {
    const { content } = await generateOllamaText({ model: opts.model, messages: [{ role: 'user', content: `Question: ${question}\nDraft answer: ${base.answer}\n\nList up to 3 specific follow-up questions whose answers would make the response more complete and concrete. STRICT JSON array of strings only.` }], temperature: 0.3 })
    followups = safeStrArr(content).slice(0, 3)
  } catch { /* no follow-ups → return the base */ }
  if (followups.length === 0) return { ...base, followups: [], rounds: 1 }

  // 2. Fan out — gather local evidence for each follow-up.
  const extra: string[] = []
  for (const fu of followups) { try { extra.push(...lexicalSearch(fu, 3).map((h) => h.text)) } catch { /* skip */ } }
  const extraEv = [...new Set(extra)].slice(0, 8)

  // 3. Refine the answer with the fanned-out evidence.
  let refined = base.answer
  try {
    const { content } = await generateOllamaText({ model: opts.model, messages: [{ role: 'user', content: `Question: ${question}\nInitial answer: ${base.answer}\n\nFollow-up evidence:\n${extraEv.map((t, i) => `(${i + 1}) ${t.slice(0, 250)}`).join('\n') || '(none)'}\n\nProduce a more complete final answer grounded ONLY in the initial answer + the evidence above. Be concise.` }], temperature: 0.3 })
    if (content.trim()) refined = content.trim()
  } catch { /* keep base */ }

  // 4. Verify the refined answer against the draft + the new evidence.
  const g = verifyGrounding(refined, [{ text: base.answer }, ...extraEv.map((t) => ({ text: t }))])
  return { ...base, answer: refined, trust: Number(g.score.toFixed(2)), grounded: g.grounded, followups, rounds: 1 }
}
