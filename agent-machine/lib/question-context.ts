/**
 * question-context — builds a per-question context graph + episodic KG entry at
 * runtime, so the model answers *enriched* by our knowledge base and vector space
 * instead of cold.
 *
 * For each question we:
 *   • vector space — semanticSearch over corpus + remediation docs (nearest chunks)
 *   • graph linking — matchDomains() ties the question to Domain/Topic/GlossaryTerm
 *     atoms (the moat); remediation lessons are recalled by similarity
 *   • context graph — mint an Episode atom and link it ABOUT_TOPIC → topics,
 *     RECALLED → retrieved lessons/chunks (a subgraph assembled for THIS question)
 *   • episodic KG — the Episode persists; recordEpisodeOutcome() writes back the
 *     answer + correctness so the system accumulates episodic memory of what it was
 *     asked and how it did (feeds the compounding loop)
 *
 * Returns grounding text to inject into the prompt + the episodeId for outcome
 * write-back.
 */
import { createHash } from 'node:crypto'
import { getHellGraph } from '@socioprophet/hellgraph'
import { semanticSearch } from './doc-store.js'
import { matchDomains } from './graphbrain-bridge.js'
import { exponentVector, primeSignature, dominantTopics } from './prime-topics.js'

export interface QuestionContext {
  episodeId: string
  grounding: string
  topics: { code: string; terms: string[] }[]
  recalled: { label: string; score: number }[]
  primeSignature: string // canonical prime-topic-vector identity of the question
  primeFactors: { code: string; exp: number; prime: number }[]
}

const EPISODE = 'Episode'

/** Assemble the context graph + episodic node for a question; return grounding. */
export async function buildQuestionContext(question: string, opts: { domainHint?: string } = {}): Promise<QuestionContext> {
  const g = getHellGraph()
  const now = new Date().toISOString()
  const episodeId = 'episode:' + createHash('sha1').update(question + '|' + now).digest('hex').slice(0, 12)

  // 1) graph linking — domains/topics this question touches (the moat)
  const domains = matchDomains(question, 2)
  const topics = domains.flatMap((d) => d.topics.slice(0, 3).map((t) => ({ code: t.code, terms: t.terms.slice(0, 5) })))

  // 1b) prime-topic decomposition — factor the question's meaning over the basis
  // primes (Moat 3 ↔ Moat 1): topic hit-counts become the exponent vector, whose
  // unique prime encoding is the question's canonical identity signature.
  const weights: Record<string, number> = {}
  for (const d of domains) for (const t of d.topics) weights[t.code] = (weights[t.code] ?? 0) + t.hits
  const evec = exponentVector(weights)
  const primeSig = primeSignature(evec)
  const primeFactors = dominantTopics(evec, 5)

  // 2) vector space — nearest corpus + remediation chunks
  const hits = await semanticSearch(question, 6)
  const lessons = hits.filter((h) => h.filename.startsWith('remediation/'))
  const refs = hits.filter((h) => !h.filename.startsWith('remediation/')).slice(0, 3)
  const recalled = [...lessons, ...refs].map((h) => ({ label: h.filename, score: Number(h.score.toFixed(3)) }))

  // 3) context graph — Episode node + edges to topics and recalled knowledge
  g.addNode(episodeId, [EPISODE], { question: question.slice(0, 500), created_at: now, status: 'open', prime_signature: primeSig, prime_factors: primeFactors.map((f) => `${f.code}^${f.exp}`).join('·') })
  for (const d of domains) {
    const did = `domain:${d.corpusRelease}`
    if (g.getNode(did)) g.addEdge('ABOUT_DOMAIN', episodeId, did, { score: d.score, at: now })
    for (const t of d.topics.slice(0, 3)) {
      const tid = `topic:${d.corpusRelease}:${t.code}`
      if (g.getNode(tid)) g.addEdge('ABOUT_TOPIC', episodeId, tid, { hits: t.hits, at: now })
    }
  }
  for (const h of [...lessons, ...refs].slice(0, 5)) {
    // link to the doc node if present (doc-store ids are content-addressed)
    const docId = `urn:noetica:doc:${h.docId}`
    g.addEdge('RECALLED', episodeId, g.getNode(h.docId) ? h.docId : docId, { score: Number(h.score.toFixed(3)), at: now })
  }

  // 4) grounding text for the prompt
  const parts: string[] = []
  if (topics.length) parts.push('Relevant domain topics: ' + topics.map((t) => `${t.code}(${t.terms.slice(0, 4).join(', ')})`).join('; '))
  if (lessons.length) parts.push('Lessons from prior mistakes:\n' + lessons.slice(0, 2).map((h, i) => `[L${i + 1}] ${h.text.slice(0, 400)}`).join('\n'))
  if (refs.length) parts.push('Reference material:\n' + refs.map((h, i) => `[R${i + 1}] ${h.text.slice(0, 300)}`).join('\n'))
  if (primeFactors.length) parts.unshift('Prime-topic decomposition of this question: ' + primeFactors.map((f) => `${f.code}^${f.exp}`).join(' · ') + ` (sig ${primeSig})`)
  const grounding = parts.length ? '\n\n## Context (knowledge base)\n' + parts.join('\n\n') : ''

  return { episodeId, grounding, topics, recalled, primeSignature: primeSig, primeFactors }
}

/** Episodic KG write-back: record the outcome on the Episode node. */
export function recordEpisodeOutcome(episodeId: string, outcome: { answer: string; correct: boolean; lane?: string }): void {
  const g = getHellGraph()
  const n = g.getNode(episodeId)
  if (!n) return
  n.properties['answer'] = outcome.answer
  n.properties['correct'] = outcome.correct
  n.properties['lane'] = outcome.lane ?? 'default'
  n.properties['status'] = 'closed'
  n.properties['closed_at'] = new Date().toISOString()
}

export function episodeCount(): number { return getHellGraph().nodesByLabel(EPISODE).length }
