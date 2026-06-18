/**
 * graphbrain-bridge — Noetica's world-class consumer of the graphbrain-contract
 * latent engine.
 *
 * graphbrain-contract is its own engine (it serves the platform / collective-
 * intelligence layer as well as the local one). Noetica consumes its output
 * *completely*: a `LatentBasisArtifact` (22-topic LDA-derived + LSA companion)
 * is lifted into the local HellGraph as the symbolic moat —
 *
 *   Domain   (the 23rd fiber / identity pole — the domain itself)
 *     │ HAS_TOPIC
 *     ▼
 *   Topic×22 (the closed basis: code + top terms + rank)
 *     │ HAS_TERM
 *     ▼
 *   GlossaryTerm (induced vocabulary, deduped across topics)
 *
 * plus a SHACL NodeShape — the domain "law" — that downstream documents are
 * validated against on write. This is what lets the neurosymbolic stack reason
 * over *structure* (atoms + shapes), not just embeddings.
 *
 * The seam is the artifact, not a repo path: callers pass parsed artifact JSON,
 * so the same bridge works whether the artifact came from the local engine or
 * was pulled from the platform layer.
 */
import { getHellGraph } from '@socioprophet/hellgraph'
import { TOPIC_PRIME } from './prime-topics.js'

/** Shape of a graphbrain LatentBasisArtifact22 (the fields we consume). */
export interface LatentBasisArtifact {
  artifact_id: string
  corpus_release_ref: string
  feature_spec_ref?: string
  basis_family: string // 'lda-derived' | 'lsa' | ...
  dimension_count: number
  topic_representation_refs?: string[] // "topic:<code>:<term,term,...>"
  training_lineage?: { run_id?: string; produced_at?: string; topic_codes?: string[]; n_documents?: number }
  created_at?: string
}

export interface ParsedTopic {
  code: string
  rank: number
  terms: string[]
}

export interface DomainBundleSummary {
  domainId: string
  corpusRelease: string
  topics: number
  glossaryTerms: number
  shapeId: string
  alreadyPresent: boolean
}

/** Parse "topic:<code>:<term, term, ...>" — terms may contain spaces; comma-delimited. */
export function parseTopicRefs(refs: string[] | undefined): ParsedTopic[] {
  if (!refs) return []
  return refs.map((ref, idx) => {
    // split on first two colons only; the remainder is the (possibly empty) term list
    const m = /^topic:([^:]+):(.*)$/.exec(ref)
    const code = m ? m[1]! : `t${idx}`
    const rest = m ? m[2]! : ''
    const terms = rest
      .split(',')
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean)
    return { code, rank: idx, terms }
  })
}

export interface DomainMatch {
  domainId: string
  corpusRelease: string
  score: number // fraction of query tokens covered by this domain's glossary
  topics: { code: string; terms: string[]; hits: number }[]
  matchedTerms: string[]
}

/**
 * The moat informing retrieval/reasoning: given a query, find which consumed
 * domain(s) it touches by overlapping query tokens against each domain's induced
 * GlossaryTerm vocabulary, and surface the matching Topics. Callers use this to
 * (a) bias retrieval toward the right domain and (b) inject the domain's topic
 * vocabulary + SHACL law as grounding into the prompt — reasoning over structure,
 * not just embeddings.
 */
export function matchDomains(query: string, topK = 2): DomainMatch[] {
  const g = getHellGraph()
  const qTokens = new Set(query.toLowerCase().split(/\W+/).filter((t) => t.length > 2))
  if (qTokens.size === 0) return []

  const out: DomainMatch[] = []
  for (const d of g.nodesByLabel(DOMAIN_LABEL)) {
    const corpus = String(d.properties['corpus_release_ref'] ?? '')
    const topicNodes = g.nodesByLabel(TOPIC_LABEL).filter((n) => n.properties['domain_id'] === d.id)
    const matched = new Set<string>()
    const topics: DomainMatch['topics'] = []
    for (const t of topicNodes) {
      const terms = String(t.properties['top_terms'] ?? '').split(',').map((s) => s.trim()).filter(Boolean)
      let hits = 0
      for (const term of terms) {
        // a glossary term matches if any of its words is a query token
        if (term.split(/\s+/).some((w) => qTokens.has(w))) { hits++; matched.add(term) }
      }
      if (hits > 0) topics.push({ code: String(t.properties['code'] ?? ''), terms, hits })
    }
    if (matched.size === 0) continue
    topics.sort((a, b) => b.hits - a.hits)
    out.push({
      domainId: d.id,
      corpusRelease: corpus,
      score: matched.size / qTokens.size,
      topics,
      matchedTerms: [...matched],
    })
  }
  return out.sort((a, b) => b.score - a.score).slice(0, topK)
}

/** kebab slug for stable, content-addressable atom ids derived from a term. */
function slug(s: string): string {
  return s.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase()
}

const DOMAIN_LABEL = 'Domain'
const TOPIC_LABEL = 'Topic'
const TERM_LABEL = 'GlossaryTerm'
const SHAPE_LABEL = 'ShaclShape'

/**
 * Build the SHACL NodeShape that encodes the domain's laws: any Document routed
 * into this domain must carry a topic_vector of the basis dimension, and the
 * domain must expose exactly `dimension_count` topics each with ≥1 term.
 * Returned as plain JSON-LD-ish SHACL so it can be persisted and fed to the
 * existing Ontogenesis SHACL-on-write gate.
 */
export function buildDomainShape(domainId: string, dimensionCount: number): Record<string, unknown> {
  return {
    '@id': `${domainId}#shape`,
    '@type': 'sh:NodeShape',
    'sh:targetClass': `${domainId}`,
    'sh:property': [
      {
        'sh:path': 'topic_vector',
        'sh:datatype': 'xsd:string',
        'sh:minCount': 1,
        'sh:description': `Document in ${domainId} must carry a ${dimensionCount}-dim topic_vector`,
      },
      {
        'sh:path': 'HAS_TOPIC',
        'sh:minCount': dimensionCount,
        'sh:maxCount': dimensionCount,
        'sh:description': `Domain exposes exactly ${dimensionCount} topics (closed basis)`,
      },
    ],
  }
}

/**
 * Consume a LatentBasisArtifact into the local HellGraph as a domain knowledge
 * bundle. Idempotent: re-consuming the same corpus release is a no-op (returns
 * alreadyPresent). The LDA-derived artifact is preferred (it carries term
 * labels); an LSA companion can be passed to attach the fast request-path basis
 * metadata, but term induction comes from LDA.
 */
export function consumeLatentArtifact(artifact: LatentBasisArtifact): DomainBundleSummary {
  const g = getHellGraph()
  const corpus = artifact.corpus_release_ref
  const domainId = `domain:${corpus}`
  const shapeId = `${domainId}#shape`

  if (g.getNode(domainId)) {
    const topics = g.nodesByLabel(TOPIC_LABEL).filter((n) => n.properties['domain_id'] === domainId)
    const terms = g.nodesByLabel(TERM_LABEL).filter((n) => String(n.properties['domains'] ?? '').includes(corpus))
    return { domainId, corpusRelease: corpus, topics: topics.length, glossaryTerms: terms.length, shapeId, alreadyPresent: true }
  }

  const topics = parseTopicRefs(artifact.topic_representation_refs)
  const now = new Date().toISOString()

  // 1) Domain atom — the 23rd fiber / identity pole (the domain itself).
  g.addNode(domainId, [DOMAIN_LABEL], {
    corpus_release_ref: corpus,
    basis_family: artifact.basis_family,
    dimension_count: artifact.dimension_count,
    n_documents: artifact.training_lineage?.n_documents ?? null,
    source_artifact_id: artifact.artifact_id,
    run_id: artifact.training_lineage?.run_id ?? null,
    created_at: now,
  })

  // 2) Topic atoms (closed basis) + 3) deduped GlossaryTerm atoms.
  const termDomains = new Map<string, Set<string>>() // term -> topic codes citing it
  let glossaryCount = 0
  for (const t of topics) {
    const topicId = `topic:${corpus}:${t.code}`
    g.addNode(topicId, [TOPIC_LABEL], {
      domain_id: domainId,
      code: t.code,
      rank: t.rank,
      prime: TOPIC_PRIME[t.code] ?? null, // the basis prime for this topic (Moat 3)
      top_terms: t.terms.join(', '),
      basis_family: artifact.basis_family,
      created_at: now,
    })
    g.addEdge('HAS_TOPIC', domainId, topicId, { rank: t.rank, at: now })

    for (const term of t.terms) {
      const termId = `glossary:${corpus}:${slug(term)}`
      if (!g.getNode(termId)) {
        g.addNode(termId, [TERM_LABEL], { term, domains: corpus, created_at: now })
        glossaryCount++
      }
      g.addEdge('HAS_TERM', topicId, termId, { at: now })
      g.addEdge('TERM_IN_DOMAIN', termId, domainId, { at: now })
      if (!termDomains.has(termId)) termDomains.set(termId, new Set())
      termDomains.get(termId)!.add(t.code)
    }
  }

  // 4) SHACL domain-law atom + the shape payload.
  const shape = buildDomainShape(domainId, artifact.dimension_count)
  g.addNode(shapeId, [SHAPE_LABEL], {
    domain_id: domainId,
    shape: JSON.stringify(shape),
    created_at: now,
  })
  g.addEdge('GOVERNED_BY', domainId, shapeId, { at: now })

  return { domainId, corpusRelease: corpus, topics: topics.length, glossaryTerms: glossaryCount, shapeId, alreadyPresent: false }
}
