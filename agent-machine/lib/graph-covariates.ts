/**
 * graph-covariates.ts — typed, VERIFIED covariates (claims) per entity.
 *
 * Microsoft GraphRAG's biggest extraction lead is covariates: first-class typed claims attached to
 * entities (subject / type / object / status / description). They extract them; they do not verify
 * them. We close the gap AND extend it: for each entity we extract typed claims from its evidence,
 * then run every claim through the grounding verifier — so each covariate carries a status that is
 * EARNED (grounded / ungrounded), not asserted. Verified covariates beat extracted covariates.
 */

import { generateOllamaText } from './ollama.js'
import { verifyGrounding } from './research-verify.js'

export interface Covariate {
  type: string          // claim type — e.g. "capability", "dependency", "ownership", "status", "fact"
  claim: string         // the claim statement
  object?: string       // the related entity/object, when the claim is relational
  grounded: boolean     // does the claim's content actually appear in the entity's evidence?
  score: number         // grounding score 0..1
  validFrom?: number    // bi-temporal: when this knowledge entered the graph (entity createdAt, epoch ms)
}

export interface EntityCovariates {
  entity: string
  covariates: Covariate[]
  grounded: number      // # of grounded covariates
}

function safeArr(s: string): Array<{ type?: string; claim?: string; object?: string }> {
  const m = s.match(/\[[\s\S]*\]/); if (!m) return []
  try { const v = JSON.parse(m[0]); return Array.isArray(v) ? v : [] } catch { return [] }
}

/** Extract + verify typed claims for one entity from its evidence passages. */
export async function extractCovariates(entity: string, evidence: string[], opts: { model: string; max?: number; persona?: string; validFrom?: number }): Promise<Covariate[]> {
  if (!entity || evidence.length === 0) return []
  const corpus = [...new Set(evidence)].join('\n---\n').slice(0, 5000)
  const prompt = `${opts.persona ? `${opts.persona}\n\n` : ''}Extract factual claims about the entity "${entity}" from the evidence below. Each claim is a typed statement grounded in the text.

Evidence:
${corpus}

Return STRICT JSON, an array (no prose), of up to ${opts.max ?? 6} claims:
[{"type":"<one of: capability|dependency|ownership|status|relationship|fact>","claim":"<a concise factual statement about ${entity}>","object":"<the other entity/thing if relational, else omit>"}]
Base every claim ONLY on the evidence. Do not infer or speculate. JSON only.`

  let parsed: Array<{ type?: string; claim?: string; object?: string }> = []
  try {
    const { content } = await generateOllamaText({ model: opts.model, messages: [{ role: 'user', content: prompt }], temperature: 0.1, numCtx: 8192 })
    parsed = safeArr(content)
  } catch { return [] }

  const ev = evidence.map((t) => ({ text: t }))
  return parsed
    .filter((c) => typeof c.claim === 'string' && c.claim.trim())
    .slice(0, opts.max ?? 6)
    .map((c) => {
      const g = verifyGrounding(String(c.claim), ev, 0.5, 0.5)
      return {
        type: (c.type || 'fact').slice(0, 24),
        claim: String(c.claim).slice(0, 240),
        ...(c.object ? { object: String(c.object).slice(0, 80) } : {}),
        grounded: g.grounded,
        score: Number(g.score.toFixed(2)),
        ...(opts.validFrom ? { validFrom: opts.validFrom } : {}),
      }
    })
}

/** Build verified covariates for a set of entities. gatherText(entity) → its evidence passages. */
export async function buildCovariates(
  entities: string[],
  gatherText: (entity: string) => string[],
  opts: { model: string; maxEntities?: number; maxPerEntity?: number; persona?: string; validFromOf?: (entity: string) => number },
): Promise<EntityCovariates[]> {
  const out: EntityCovariates[] = []
  for (const entity of entities.slice(0, opts.maxEntities ?? 12)) {
    const vf = opts.validFromOf?.(entity)
    const covariates = await extractCovariates(entity, gatherText(entity), { model: opts.model, max: opts.maxPerEntity ?? 6, ...(opts.persona ? { persona: opts.persona } : {}), ...(vf ? { validFrom: vf } : {}) })
    if (covariates.length) out.push({ entity, covariates, grounded: covariates.filter((c) => c.grounded).length })
  }
  return out
}
