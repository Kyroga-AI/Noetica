/**
 * topic-tier.ts — tiered ontology matching as a TYPED-MORPHISM operation across three connective layers.
 *
 * The opspine4 keyed-vec breakdown showed a flat single-layer topic map drags queries to the wrong abstraction
 * level: intro/undergrad physics (conceptual_physics, college_physics) both matched the GRADUATE topic
 * "Particle Physics & QFT" at cos 0.49. A flat nearest-neighbour has no tier structure, so a mediocre off-level
 * match wins — which is why retrieval pulled off-level, often cross-domain chunks and underperformed baseline.
 *
 * THE STRUCTURE (the operation, not a heuristic): three layers crossed by structure-preserving maps —
 *   UPPER   — universal categories (KKO Peircean Generals/Particulars/Possibilities + DBpedia/KBpedia RCs)
 *   MIDDLE  — the GENERAL layer (e.g. "general physics") — the CONNECTIVE TISSUE
 *   LOWER   — the SPECIFIC subdomain (e.g. the rigorous "college_physics: E&M")
 *
 *   upper  --SURJECTION-->  middle    every general topic is COVERED by a universal category (onto) → coverage
 *                                     is guaranteed; the universal never fails to reach the general.
 *   lower  --INJECTION-->   middle    each specific topic has a UNIQUE general home it maps into (1-to-1 into);
 *                                     two distinct specifics never collapse to the same general improperly.
 *   middle <--BIJECTION-->  lower     where a general topic has exactly ONE specific realization (1-to-1 onto).
 *
 * GROUNDING FLOW — GENERAL FIRST, then refine (top-down, per the connective order): anchor at UPPER, establish
 * the MIDDLE/general topic FIRST (general physics bridges KKO down to college physics), THEN refine to a LOWER
 * specific topic ONLY IF it INJECTS into that established general (its `injectsInto` parent) and fits the query.
 * The graduate-QFT drag is now barred STRUCTURALLY (it injects into a different general parent), not by a floor.
 */

export type Tier = 'upper' | 'middle' | 'lower'
export type Morphism = 'surjection' | 'injection' | 'bijection'

/** A topic in the tiered space. `injectsInto` = the middle/general topic a LOWER injects into (its unique home);
 *  `coveredBy` = the upper category that surjects onto a MIDDLE. `cos` = similarity to the query under match. */
export interface TierTopic {
  tier: Tier
  id: string
  cos: number
  injectsInto?: string   // lower → its general (middle) parent
  coveredBy?: string     // middle → its universal (upper) category
}

export interface TierGrounding {
  anchor: string | null          // upper universal category (surjective coverage)
  general: string | null         // middle topic — the connective tissue (established first)
  specific: string | null        // lower topic — refined into, only if it injects into `general`
  level: Tier                    // the most-specific tier actually grounded
  crossings: Morphism[]          // the morphisms traversed: surjection (upper→middle), injection (lower→middle), bijection
  grounded: boolean              // reached middle or lower (a real topic), not upper-only
  rationale: string
}

export const MIDDLE_FLOOR = 0.42   // a general topic must clear this to be the connective tissue
export const LOWER_FLOOR = 0.5     // a specific topic must clear this to refine past its general home

/**
 * Ground a query through the tiered space, general-first. Candidates carry their per-tier cosine to the query
 * plus the structural links (`injectsInto`, `coveredBy`). Returns the traversal: universal anchor → general
 * (connective tissue) → specific (refinement), with the morphisms crossed.
 */
export function groundTiered(cands: TierTopic[], opts: { middleFloor?: number; lowerFloor?: number } = {}): TierGrounding {
  // Floors default to the embedding-cosine calibration; a caller using a different similarity (e.g. a lexical
  // scorer) passes its own floors so the same traversal logic works across scoring regimes.
  const middleFloor = opts.middleFloor ?? MIDDLE_FLOOR
  const lowerFloor = opts.lowerFloor ?? LOWER_FLOOR
  const byTier = (t: Tier) => cands.filter((c) => c.tier === t).sort((a, b) => b.cos - a.cos)
  const crossings: Morphism[] = []

  // UPPER: the universal anchor. The surjection guarantees coverage — there is always a category above the general.
  const anchor = byTier('upper')[0]?.id ?? null

  // MIDDLE (general): established FIRST — the connective tissue. Must clear the floor to count as grounding.
  const middle = byTier('middle').find((c) => c.cos >= middleFloor) ?? null
  if (!middle) {
    return { anchor, general: null, specific: null, level: 'upper', crossings: anchor ? ['surjection'] : [], grounded: false,
      rationale: anchor ? 'no general topic cleared the floor → universal anchor only (coarse coverage via surjection)' : 'no candidates' }
  }
  if (anchor) crossings.push('surjection')   // upper --surjection--> middle (covered)

  // LOWER (specific): refine ONLY into a specific topic that INJECTS into the established general AND fits.
  // A lower whose `injectsInto` is a DIFFERENT general parent is structurally excluded (this bars the graduate
  // drag: QFT injects into 'particle physics', not the chosen 'general physics').
  const specific = byTier('lower').find((c) => c.injectsInto === middle.id && c.cos >= lowerFloor) ?? null
  if (specific) {
    crossings.push('injection')   // lower --injection--> middle (refined into the specific)
    // bijection: the general has exactly one specific realization here (1-to-1 onto).
    const realizations = cands.filter((c) => c.tier === 'lower' && c.injectsInto === middle.id)
    if (realizations.length === 1) crossings.push('bijection')
    return { anchor, general: middle.id, specific: specific.id, level: 'lower', crossings, grounded: true,
      rationale: `general '${middle.id}' (connective tissue) → injected to specific '${specific.id}'` }
  }

  return { anchor, general: middle.id, specific: null, level: 'middle', crossings, grounded: true,
    rationale: `grounded at general '${middle.id}'; no specific topic injects into it above floor → stay general` }
}
