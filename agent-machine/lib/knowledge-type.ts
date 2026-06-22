/**
 * knowledge-type — classify a question by the 7 ARC knowledge types (Boratko et al. 2018) and route
 * it to the SOLVER it depends on, BEFORE answering. This is the "understand first" step that decides
 * whether a turn is LOOKUP-dominated (retrieve), COMPUTE-dominated (verified sympy), or MODEL-dominated
 * (reason/generate) — the per-question fine gate beside the action-polarity coarse gate.
 *
 * Ported from scripts/knowledge_type.py (was bench-only) so the DIALOGUE can classify every turn.
 * Validated by the 2025-26 medical-QA literature: ~33% of medical QA is reasoning-bound and ~67% is
 * knowledge-bound; RAG helps the lookup bucket, reasoning the model bucket, and uncertainty-gating
 * decides between them (Med-Gemini, MedRAG/MIRAGE, "Disentangling Reasoning & Knowledge" 2505.11462).
 */

export type KnowledgeType = 'Definition' | 'BasicFacts' | 'Purpose' | 'CausesProcesses' | 'Algebraic' | 'Experiments' | 'PhysicalModel'
export type Solver = 'retrieve' | 'compute' | 'chain' | 'spatial' | 'experiment'
export type Dominance = 'lookup' | 'compute' | 'model'
export interface KnowledgeClass { types: KnowledgeType[]; solver: Solver; dominance: Dominance }

const TYPES: Record<KnowledgeType, { solver: Solver; sigs: RegExp[] }> = {
  Definition: { solver: 'retrieve', sigs: [/\bis called\b/i, /\bterm for\b/i, /\bdefined as\b/i, /\bthe name (for|of)\b/i, /\bbest describes\b/i, /\bdefinition of\b/i, /\brefers to\b/i, /\bwhat (is|are) (a|an|the)\b/i, /\bwhat'?s (a|an|the)\b/i] },
  BasicFacts: { solver: 'retrieve', sigs: [/\bhow many\b/i, /\bwhich (of the )?(following )?(element|compound|gas|metal|organ|planet|part|drug|enzyme|hormone)\b/i, /\bwhat (is|are) the\b/i, /\bmade (up )?of\b/i, /\bconsists? of\b/i] },
  Purpose: { solver: 'retrieve', sigs: [/\bfunction of\b/i, /\bpurpose of\b/i, /\brole of\b/i, /\bused (to|for)\b/i, /\bwhy (do|does|are|is)\b/i, /\bin order to\b/i, /\bhelps? (to )?\b/i] },
  // NOTE: "best describes" lives in Definition (lookup), NOT here — a "which best describes X" question
  // is a definition lookup, and since 'chain' outranks 'retrieve' (line ~52) keeping it here would
  // mis-route every such lookup to model-dominance. "best explains" IS causal, so it stays.
  CausesProcesses: { solver: 'chain', sigs: [/\bfirst step\b/i, /\bprocess\b/i, /\bsequence\b/i, /\bstages?\b/i, /\bcycle\b/i, /\bwhat happens (when|after|next|if)\b/i, /\bin order\b/i, /\bsteps?\b/i, /\bleads? to\b/i, /\bresults? in\b/i, /\bcauses?\b/i, /\bexemplif/i, /\bexample of\b/i, /\billustrat/i, /\bdemonstrat/i, /\b(homolog|analog|convergent|divergent|vestigial)\w*\b/i, /\bbest explains\b/i, /\bmost likely (cause|diagnosis|explanation)\b/i] },
  // `=` must be a REAL equality (digit/var on the left, signed number on the right) — a bare /=/ fired on
  // ==, <=, !=, and any stray '=' in prose, force-routing non-numeric questions to the compute solver.
  Algebraic: { solver: 'compute', sigs: [/\bcalculate\b/i, /\bhow much\b/i, /\bhow far\b/i, /\bhow fast\b/i, /\bhow long\b/i, /\bwhat is the (value|magnitude|force|velocity|energy|current|mass|speed|frequency|resistance|acceleration|momentum|pressure|power|charge|wavelength|volume|density|work|probability)\b/i, /[\dxyz)]\s*=\s*[-+(]?\s*\d/i, /\bsolve\b/i, /\bequation\b/i] },
  Experiments: { solver: 'experiment', sigs: [/\bexperiment/i, /\bhypothes/i, /\bcontrol(led| group| variable)?\b/i, /\bindependent variable\b/i, /\bscientists?\b/i, /\bmeasure(ment)?\b/i, /\bobserv/i, /\btest(ed|ing)?\b/i, /\bdata\b/i, /\btrial\b/i] },
  PhysicalModel: { solver: 'spatial', sigs: [/\bmoves?\b/i, /\bmoving\b/i, /\bcollid/i, /\bdirection\b/i, /\bdistance\b/i, /\bpath\b/i, /\bwhat (most likely )?happens when\b/i, /\bair mass\b/i, /\borbit/i, /\bgravit/i, /\bfriction\b/i] },
}

const UNIT = /\d\s*(m\/s|kg|mol|N\b|J\b|W\b|V\b|A\b|Hz|cm|mm|km|°|K\b|Pa|ohm|Ω|g\b|L\b|eV|nm|mg|ml|mmHg|watt|volt|joule|gram|meter|second)/i
const NUM = /\b\d+(\.\d+)?\b/

const SOLVER_DOMINANCE: Record<Solver, Dominance> = {
  retrieve: 'lookup', compute: 'compute', chain: 'model', spatial: 'model', experiment: 'model',
}

/** Classify a question by knowledge type → solver → lookup/compute/model dominance. Multi-label. */
export function classifyKnowledge(question: string): KnowledgeClass {
  const hits: KnowledgeType[] = []
  for (const t of Object.keys(TYPES) as KnowledgeType[]) {
    if (TYPES[t].sigs.some((s) => s.test(question))) hits.push(t)
  }
  // numeric fallback → Algebraic ONLY on a real physical quantity (unit). A bare number — an age
  // ("55-year-old"), a year, patient demographics in a clinical vignette — must NOT route to compute;
  // that mislabels a reasoning question. (Explicit math — "=", solve, calculate, probability — is
  // already a typed Algebraic signal above; hyphens in compounds are NOT minus operators.)
  if (!hits.includes('Algebraic') && UNIT.test(question)) {
    hits.push('Algebraic')
  }
  const types = hits.length ? hits : (['BasicFacts'] as KnowledgeType[])
  // pick the highest-PRIORITY solver among matched types — a question that is BOTH "which…" and
  // computational must route to compute, not retrieve.
  const solvers = new Set(types.map((t) => TYPES[t].solver))
  const solver: Solver = (['compute', 'chain', 'spatial', 'experiment', 'retrieve'] as Solver[]).find((s) => solvers.has(s)) ?? 'retrieve'
  return { types, solver, dominance: SOLVER_DOMINANCE[solver] }
}
