/**
 * intent-embed — Tier-0 of the model cascade: a tiny embedding model (nomic-embed-
 * text, ~0.3GB, ~60ms warm) does multi-label intent classification, then the 3B
 * generates, then a 7B only on escalation. Embeddings give what the regex cues can't:
 * calibrated confidence (cosine similarity, not a murky cue-length score) and
 * robustness to paraphrase — "what is a clinical trial?" lands near explain/research
 * even with no literal cue match.
 *
 * Centroids are built once from curated exemplars per intent (cached in memory).
 * Pure cascade technique: a cheap classifier up front so the expensive model only
 * ever sees a well-routed, well-grounded turn.
 */
import { embedText, cosineSim } from './ollama.js'

// Canonical exemplars per intent — their mean embedding is the intent's centroid.
const EXEMPLARS: Record<string, string[]> = {
  build_implement: ['build a login form', 'create a new dashboard component', 'implement user authentication', 'add a settings page'],
  fix_debug: ['the upload is broken', 'fix this crash', 'it throws an error on save', 'the build is failing'],
  research_lookup: ['research the latest developments', 'look up who invented this', "what's the current price", 'find information about this topic'],
  summarize_doc: ['summarize this report', 'give me the key points of the document', 'tldr of the paper', "what's the gist of this file"],
  qa_over_doc: ['what does the document say about this', 'according to the report what is the risk', 'based on the uploaded file explain this', 'in the paper how do they handle it'],
  explain_teach: ['explain how oauth works', 'teach me about vectors', 'how does this algorithm work', 'help me understand transformers'],
  plan_nextsteps: ['what are the next steps', 'what are the gaps', "what's the plan from here", "what's left to do"],
  review_audit: ['review this for issues', 'audit the security', 'assess the quality of this', 'go over this and find problems'],
  compare_benchmark: ['compare these two options', 'which is better a or b', 'benchmark these models', "what's the difference between them"],
  self_identity: ['how do you work', 'what are you', 'what repos build you', 'tell me about your architecture'],
  preferences_memory: ['remember that i prefer this', 'from now on always do this', "don't ever use that", 'my preference is the following'],
  configure_ops: ['install the dependencies', 'set up the environment', 'configure the server', 'deploy the app'],
  file_ingest: ['upload this document', 'ingest the pdf', 'load this file into the knowledge base', 'add this paper'],
  file_ops: ['list the files in downloads', 'read the config file', 'find all the markdown files', 'move the file to docs'],
  status_check: ['is it running', 'does it work now', "what's the status", 'did the build succeed'],
  code_review: ['review my pull request', 'look at this code', 'review this diff', 'check my code for problems'],
  compute_math: ['compute the determinant', 'calculate the probability', 'solve for x', "what's the integral of this"],
  prove_reason: ['prove this theorem', 'derive the formula', 'show that this holds', 'is it true that this is correct'],
  write_draft: ['write an email to the team', 'draft a proposal', 'compose a message', 'rewrite this paragraph'],
  converse_smalltalk: ['hey there', 'good morning', 'how are you', 'hello'],
  confirm_steer: ['yes proceed', 'go ahead', 'sounds good do it', 'okay continue'],
  meta_capability: ['what can you do', 'what are your capabilities', 'how can you help me', 'what do you do'],
}

let centroids: { name: string; vec: number[] }[] | null = null
let building: Promise<void> | null = null

function meanVec(vecs: number[][]): number[] {
  if (vecs.length === 0) return []
  const d = vecs[0]!.length
  const out = new Array(d).fill(0)
  for (const v of vecs) for (let i = 0; i < d; i++) out[i] += v[i]!
  for (let i = 0; i < d; i++) out[i] /= vecs.length
  return out
}

/** Build (and cache) the per-intent centroids. Idempotent + concurrency-safe. */
export async function buildCentroids(): Promise<void> {
  if (centroids) return
  if (building) return building
  building = (async () => {
    const built: { name: string; vec: number[] }[] = []
    for (const [name, phrases] of Object.entries(EXEMPLARS)) {
      const vecs: number[][] = []
      for (const p of phrases) {
        const v = await embedText(p)
        if (v.length) vecs.push(v)
      }
      if (vecs.length) built.push({ name, vec: meanVec(vecs) })
    }
    if (built.length) centroids = built
  })()
  try { await building } finally { building = null }
}

export interface EmbedClassification {
  name: string                              // top intent
  confidence: number                        // cosine sim of the top intent (0..1)
  margin: number                            // gap to the 2nd intent (how decisive)
  labels: { name: string; sim: number }[]   // multi-label: all intents, ranked
}

/** Classify a turn by cosine similarity to the intent centroids. Returns null if the
 *  embed model is unavailable (caller falls back to the regex classifier). */
export async function classifyEmbed(query: string): Promise<EmbedClassification | null> {
  if (!centroids) { try { await buildCentroids() } catch { return null } }
  if (!centroids) return null
  const q = await embedText(query)
  if (!q.length) return null
  const labels = centroids
    .map((c) => ({ name: c.name, sim: Number(cosineSim(q, c.vec).toFixed(3)) }))
    .sort((a, b) => b.sim - a.sim)
  const top = labels[0]!
  return {
    name: top.name,
    confidence: top.sim,
    margin: Number((top.sim - (labels[1]?.sim ?? 0)).toFixed(3)),
    labels,
  }
}
