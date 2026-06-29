/**
 * tiered-ground.ts — the CANDIDATE PROVIDER that makes topic-tier.ts real, plus the ontogenesis integration of
 * the verified experience memory.
 *
 * topic-tier.groundTiered is a pure traversal over TierTopic candidates but had NO source feeding it. This builds
 * those candidates from in-repo canon (no external download — KBpedia's 58k RCs are not vendored, but the
 * frontier-authored KKO upper tier + domain anchors ARE, in canon/upper-tier-concepts.json, and canon-lookup
 * already has the leveled spec topics):
 *
 *   UPPER   ← canon/upper-tier-concepts.json  (KKO universal categories + per-domain anchors)
 *   MIDDLE  ← a synthesized "general <domain>" node per domain (the connective tissue), described by the domain
 *             anchor + that domain's INTRO-level topics (the "high-school <domain>" the user asked to bridge through)
 *   LOWER   ← canon spec topics at undergrad/graduate/professional level (the rigorous specific subdomain),
 *             each INJECTING into its domain's "general <domain>" middle node.
 *
 * GENERAL-FIRST is enforced by groundTiered: establish the middle, then refine to a lower only if it injects into
 * that middle. So "college physics: E&M" is reached THROUGH "general physics", never by a flat off-level nearest
 * neighbour (the graduate-QFT drag the flat map suffered).
 *
 * Similarity is INJECTED (`scorer`): production passes an embedding-cosine scorer (with the calibrated floors);
 * offline/tests pass a deterministic or lexical scorer with its own floors. The function is otherwise pure.
 *
 * ONTOGENESIS INTEGRATION: once the tier is grounded, the verified PROCEDURAL tier is attached — retrieveExperiences
 * (PR #307, gated/verified-only) keyed by the question — so grounding surfaces BOTH the declarative tiers
 * (KKO → general → specific) AND the reasoning paths that solved similar tasks. Declarative + procedural in one block.
 */
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { groundTiered, type TierTopic, type TierGrounding } from './topic-tier.js'
import { canonTopics } from './canon-lookup.js'
import { retrieveExperiences, renderExperiences, type ReasoningExperience } from './procedural-memory.js'

const CANON = process.env['CANON_DIR'] || join(__dirname, '..', 'canon')

interface KkoCategory { id: string; label: string; description: string }
interface DomainAnchor { id: string; domain: string; general: string; kko: string; label: string; description: string }
interface UpperTier { kko_categories: KkoCategory[]; domain_anchors: DomainAnchor[] }

let _upper: UpperTier | null | undefined
function loadUpper(): UpperTier | null {
  if (_upper !== undefined) return _upper
  try {
    const p = join(CANON, 'upper-tier-concepts.json')
    _upper = existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as UpperTier) : null
  } catch { _upper = null }
  return _upper
}

/** A similarity in [0,1] between the query and a concept's text. Injected so production can use embedding cosine. */
export type Scorer = (query: string, conceptText: string) => number | Promise<number>

/** Default OFFLINE scorer: token-containment (fraction of the concept's salient tokens present in the query).
 *  Coarse but dependency-free; production should inject an embedding-cosine scorer for real grounding. */
export function lexicalScore(query: string, conceptText: string): number {
  const tok = (s: string) => new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2))
  const q = tok(query), c = tok(conceptText)
  if (!c.size) return 0
  let hit = 0
  for (const t of c) if (q.has(t)) hit++
  return hit / c.size
}

/** Production scorer: embedding cosine via Ollama, with a per-instance cache so each concept/query embeds once.
 *  Lazy-imports ollama/vec-sim so the rest of this module stays dependency-light and offline-testable. Returns a
 *  scorer to inject AND the calibrated floors (the MIDDLE_FLOOR/LOWER_FLOOR regime topic-tier was tuned for). */
export function embeddingScorer(): { scorer: Scorer; middleFloor: number; lowerFloor: number } {
  const cache = new Map<string, number[]>()
  const scorer: Scorer = async (query, conceptText) => {
    try {
      const { embedText } = await import('./ollama.js')
      const { cosineSim } = await import('./vec-sim.js')
      const get = async (s: string) => { let v = cache.get(s); if (!v) { v = await embedText(s); cache.set(s, v) } return v }
      const [q, c] = await Promise.all([get(query), get(conceptText)])
      return q.length && c.length ? cosineSim(q, c) : 0
    } catch { return 0 }   // embedder down → score 0, grounding degrades to anchor/none (safe)
  }
  return { scorer, middleFloor: 0.42, lowerFloor: 0.5 }
}

export interface TierBuildOpts { scorer?: Scorer }

/**
 * Build the three-tier candidate set for a question from in-repo canon. Pure aside from the injected scorer
 * (which may be async — every score is awaited). Returns [] if the upper tier file is absent (degrade safely).
 */
export async function buildTierCandidates(question: string, opts: TierBuildOpts = {}): Promise<TierTopic[]> {
  const up = loadUpper()
  if (!up) return []
  const scorer = opts.scorer ?? lexicalScore
  const score = async (text: string) => Math.max(0, Math.min(1, await scorer(question, text)))
  const cands: TierTopic[] = []

  // INTRO topics per domain — they describe the "general <domain>" (high-school-level) connective tissue.
  const topics = canonTopics()
  const introByDomain = new Map<string, string[]>()
  for (const t of topics) if (t.level === 'intro') (introByDomain.get(t.domain) ?? introByDomain.set(t.domain, []).get(t.domain)!).push(t.topic)

  // UPPER: KKO universal categories + the per-domain anchors.
  for (const k of up.kko_categories) cands.push({ tier: 'upper', id: k.id, cos: await score(`${k.label}. ${k.description}`) })
  const generalOf = new Map<string, string>()   // domain → its "general <domain>" middle id (canonical, honors underscores)
  for (const a of up.domain_anchors) {
    generalOf.set(a.domain, a.general)
    cands.push({ tier: 'upper', id: a.id, cos: await score(`${a.label}. ${a.description}`) })
    // MIDDLE: the synthesized general node — described by the anchor + the domain's intro topics.
    const intros = (introByDomain.get(a.domain) ?? []).join(', ')
    cands.push({ tier: 'middle', id: a.general, cos: await score(`${a.label}. ${a.description} ${intros}`), coveredBy: a.id })
  }

  // LOWER: every non-intro spec topic — the rigorous specific subdomain, injecting into its domain's general node.
  for (const t of topics) {
    if (t.level === 'intro') continue
    const general = generalOf.get(t.domain)
    if (!general) continue   // a domain with no anchor has no general home to inject into
    cands.push({ tier: 'lower', id: `${t.domain}: ${t.topic}`, cos: await score(`${t.topic} (${t.domain}, ${t.level})`), injectsInto: general })
  }
  return cands
}

export interface TieredGroundResult {
  grounding: TierGrounding
  candidates: number
  experiences: Array<ReasoningExperience & { relevance: number }>
  block: string                 // a ready-to-inject prompt block (tiers + verified experiences), '' when nothing grounded
}

export interface TieredGroundOpts {
  scorer?: Scorer
  middleFloor?: number          // override floors to match the scorer's regime (lexical needs lower floors than cosine)
  lowerFloor?: number
  experiences?: ReasoningExperience[]                       // the gated experience store (PR #307) for the procedural tier
  expMatch?: (a: string, b: string) => number              // match fn for retrieveExperiences (jaccard / embedding)
  expTopK?: number
}

/** Render the tiered grounding as a compact prompt block (general-first), '' when not grounded. */
function renderTiers(g: TierGrounding): string {
  if (!g.grounded) return g.anchor ? `\n\n---\n**Topic tier**: universal category ${g.anchor} only (no specific topic matched).\n---\n` : ''
  const lines = [`universal: ${g.anchor ?? '(none)'}`, `general (connective): ${g.general}`]
  if (g.specific) lines.push(`specific: ${g.specific}`)
  lines.push(`morphisms: ${g.crossings.join(' → ') || '(none)'}`)
  return `\n\n---\n**Topic tier** (ground at the general level first, then the specific):\n${lines.map((l) => `- ${l}`).join('\n')}\n---\n`
}

/**
 * Ground a question through the tiered ontology AND attach the verified procedural tier. The ONE entry point the
 * grounding lane calls: builds candidates from canon, runs the general-first traversal, and folds in retrieved
 * verified experiences. Async (scorer may embed). Degrades to an empty block when nothing grounds.
 */
export async function tieredGround(question: string, opts: TieredGroundOpts = {}): Promise<TieredGroundResult> {
  const cands = await buildTierCandidates(question, { scorer: opts.scorer })
  const grounding = groundTiered(cands, { middleFloor: opts.middleFloor, lowerFloor: opts.lowerFloor })

  // ONTOGENESIS: the procedural tier — verified reasoning paths for a similar task (gated store, PR #307).
  let experiences: Array<ReasoningExperience & { relevance: number }> = []
  if (opts.experiences?.length && opts.expMatch) {
    experiences = retrieveExperiences(question, opts.experiences, opts.expMatch, { topK: opts.expTopK ?? 3 })
  }

  const block = `${renderTiers(grounding)}${renderExperiences(experiences)}`
  return { grounding, candidates: cands.length, experiences, block }
}
