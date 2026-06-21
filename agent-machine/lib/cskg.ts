/**
 * cskg — align Noetica's graph edges to the CSKG (CommonSense Knowledge Graph / KGTK) spec
 * so we "get the full deal": every edge carries a `relation;dimension` (one of the CSKG
 * semantic categories), lifted labels, and source/sentence provenance, and can be exported
 * in the canonical KGTK edge-TSV format.
 *
 * CSKG edge columns (KGTK): id | node1 | relation | node2 | node1;label | node2;label |
 *   relation;label | relation;dimension | source | sentence.
 * Ref: Ilievski, Szekely, Zhang — "CSKG: The CommonSense Knowledge Graph" (USC ISI), and the
 * project's "Common Sense Knowledge Graph specification" doc.
 *
 * Pure + dependency-free. dimensionOf() mirrors graph-surface.epistemicOf() (a TRUST axis) —
 * this is the orthogonal SEMANTIC axis the CSKG spec requires.
 */

/** The CSKG relation dimensions (semantic category of a relation). */
export const CSKG_DIMENSIONS = [
  'taxonomic', 'part-whole', 'causation', 'temporal', 'spatial', 'similarity',
  'distinctness', 'desire', 'quality', 'creation', 'utility', 'social', 'co-occurrence', 'functional',
] as const
export type CskgDimension = typeof CSKG_DIMENSIONS[number]

/** Explicit mapping for Noetica's known relation labels → CSKG dimension. */
const REL_DIMENSION: Record<string, CskgDimension> = {
  PRODUCED: 'creation', GROUNDS: 'taxonomic', ABOUT_DOMAIN: 'taxonomic', ABOUT_TOPIC: 'taxonomic',
  HAS_TOPIC: 'taxonomic', HAS_TERM: 'taxonomic', TERM_IN_DOMAIN: 'taxonomic', HAS_SYMBOL: 'part-whole',
  HAS_TURN: 'temporal', TOUCHED: 'part-whole', PROGRESSES: 'temporal', HAS_GOAL: 'part-whole',
  GOVERNED_BY: 'utility', RECALLED: 'temporal', TWIN_OF: 'social', OBSERVED_BY: 'social', TWIN_OBSERVED: 'social',
  BELIEF_OF: 'social', TWIN_BELIEVES: 'social', LAW_OF: 'causation', DERIVED_IN: 'causation',
  WORLD_STATE_OF: 'temporal', CYCLE_OF: 'temporal', PROCESSED_OBS: 'temporal', CLAIMS: 'social', CLAIMED_BY: 'social',
  REMEDIATES: 'causation', PART_OF_SELF: 'part-whole', CERTIFIED_BY: 'utility', COOCCURS_WITH: 'co-occurrence',
  RELATED_TO: 'similarity', SAME_AS: 'similarity', MERGE_PROPOSAL: 'similarity',
}

/** The CSKG semantic dimension of a relation: explicit map first, then keyword fallback. */
export function dimensionOf(relation: string): CskgDimension {
  const exact = REL_DIMENSION[(relation ?? '').toUpperCase()]
  if (exact) return exact
  const k = (relation ?? '').toLowerCase()
  if (/produce|creat|author|mint|generat/.test(k)) return 'creation'
  if (/turn|recall|cycle|world_state|temporal|progress|before|after|when/.test(k)) return 'temporal'
  if (/derive|law|remediat|cause|effect|because|leads_to/.test(k)) return 'causation'
  if (/twin|observ|belief|believ|claim|consent|social|friend|agent/.test(k)) return 'social'
  if (/has_topic|has_term|term_in|about_|isa|is_a|type_of|subclass|class|ground|taxonom/.test(k)) return 'taxonomic'
  if (/part_|_of_self|partof|touch|contains|has_|member|symbol|component/.test(k)) return 'part-whole'
  if (/near|located|spatial|inside|above|below/.test(k)) return 'spatial'
  if (/similar|match|merge|cluster|analog|related|same_as|synonym/.test(k)) return 'similarity'
  if (/distinct|antonym|different|not_/.test(k)) return 'distinctness'
  if (/govern|certif|used_for|purpose|utility|capable/.test(k)) return 'utility'
  if (/cooccur|co_occur|cooccurs/.test(k)) return 'co-occurrence'
  return 'functional'
}

/** Human-readable relation label ("HAS_TOPIC" → "has topic"). */
export function relationLabel(relation: string): string {
  return (relation ?? '').toLowerCase().replace(/_/g, ' ').trim()
}

/** A CSKG/KGTK edge record (column names match the spec, including the `;`-qualified ones). */
export interface CskgEdge {
  id: string
  node1: string
  relation: string
  node2: string
  'node1;label'?: string
  'node2;label'?: string
  'relation;label': string
  'relation;dimension': CskgDimension
  source?: string
  sentence?: string
}

export interface RawEdge {
  id?: string; label: string; from: string; to: string
  properties?: Record<string, unknown>
}

/** Project a Noetica graph edge into a CSKG/KGTK edge record. */
export function toCskgEdge(e: RawEdge, labels?: { node1?: string; node2?: string }): CskgEdge {
  const p = e.properties ?? {}
  const rel = e.label
  return {
    id: e.id ?? `${e.from}-${rel}-${e.to}`,
    node1: e.from,
    relation: rel,
    node2: e.to,
    ...(labels?.node1 ? { 'node1;label': labels.node1 } : {}),
    ...(labels?.node2 ? { 'node2;label': labels.node2 } : {}),
    'relation;label': relationLabel(rel),
    'relation;dimension': dimensionOf(rel),
    ...(p['source'] != null ? { source: String(p['source']) } : {}),
    ...(p['sentence'] != null ? { sentence: String(p['sentence']) } : {}),
  }
}

const KGTK_COLUMNS = ['id', 'node1', 'relation', 'node2', 'node1;label', 'node2;label', 'relation;label', 'relation;dimension', 'source', 'sentence'] as const
const tsvCell = (v: unknown): string => String(v ?? '').replace(/[\t\n\r]/g, ' ')

/** Serialize CSKG edges to the canonical KGTK edge-TSV (tab-separated, spec column order). */
export function toKgtkTsv(edges: CskgEdge[]): string {
  const header = KGTK_COLUMNS.join('\t')
  const rows = edges.map((e) => KGTK_COLUMNS.map((c) => tsvCell((e as Record<string, unknown>)[c])).join('\t'))
  return [header, ...rows].join('\n')
}
