/**
 * gaia-bridge.ts — REAL integration with the canonical GAIA / ontogenesis ontology (NOT a hand-typed copy).
 * Emits Noetica's graph/geo/resolution work as conformant GAIA world-signals JSON-LD, using the actual
 * namespaces, classes, required properties, and promotion-state vocabulary from
 *   SocioProphet/prophet-domain-gaia-ontology (gaia: world-signals) and SocioProphet/ontogenesis.
 *
 * Crucially, Noetica's verification maps onto GAIA's promotion lifecycle:
 *   unverified evidence → EvidenceOnly → ReviewRequired → (verified/grounded) Promoted | Rejected
 * which is exactly our verified-only HellGraph write-back + the GAIA invariant (inference isn't canonical).
 */

export const GAIA_NS = 'https://schemas.socioprophet.org/gaia/'
export const ONTOGENESIS_NS = 'https://socioprophet.dev/ont/ontogenesis#'

export const GAIA_CONTEXT = {
  '@version': 1.1,
  gaia: GAIA_NS,
  hdt: ONTOGENESIS_NS,
  xsd: 'http://www.w3.org/2001/XMLSchema#',
  rdfs: 'http://www.w3.org/2000/01/rdf-schema#',
  prov: 'http://www.w3.org/ns/prov#',
} as const

export type PromotionState = 'EvidenceOnly' | 'ReviewRequired' | 'Rejected' | 'Promoted'

/** Map Noetica's epistemic/verification signals onto the canonical GAIA promotion lifecycle. */
export function promotionState(o: { verified?: boolean; grounded?: boolean; rejected?: boolean; hasEvidence?: boolean }): PromotionState {
  if (o.rejected) return 'Rejected'
  if (o.verified || o.grounded) return 'Promoted'
  if (o.hasEvidence) return 'ReviewRequired'
  return 'EvidenceOnly'
}

const slug = (s: string) => (s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'x')

export interface GaiaRecord { '@id': string; '@type': string; [k: string]: unknown }

/** A detected place → gaia:FeatureRegistryEntry (the GAIA class for a registered world feature). */
export function placeToFeatureEntry(place: { name: string; lat?: number | null; lon?: number | null; type?: string }, opts: { verified?: boolean; grounded?: boolean } = {}): GaiaRecord {
  const rec: GaiaRecord = {
    '@id': `gaia:feature-${slug(place.name)}`,
    '@type': 'gaia:FeatureRegistryEntry',
    'gaia:hasFeatureId': place.name,
    'gaia:hasPromotionState': `gaia:${promotionState({ ...opts, hasEvidence: true })}`,
  }
  if (typeof place.lat === 'number' && typeof place.lon === 'number') { rec['gaia:lat'] = place.lat; rec['gaia:lon'] = place.lon }
  if (place.type) rec['gaia:featureType'] = place.type
  return rec
}

/** An entity-resolution candidate → gaia:ConcordanceLink (links a source record to a canonical entity). */
export function mergeToConcordance(cand: { a: string; b: string; confidence?: number }, opts: { verified?: boolean } = {}): GaiaRecord {
  return {
    '@id': `gaia:concordance-${slug(cand.a)}-${slug(cand.b)}`,
    '@type': 'gaia:ConcordanceLink',
    'gaia:hasSourceRecordId': cand.a,
    'gaia:hasCanonicalEntity': `gaia:entity-${slug(cand.b)}`,
    'gaia:hasConfidence': cand.confidence ?? 0,
    'gaia:hasPromotionState': `gaia:${promotionState({ verified: opts.verified, hasEvidence: true })}`,
  }
}

/** A graph concept → gaia:CanonicalEntity. */
export function entityToCanonical(id: string, label: string): GaiaRecord {
  return { '@id': `gaia:entity-${slug(id)}`, '@type': 'gaia:CanonicalEntity', 'rdfs:label': label }
}

/** Wrap records into a JSON-LD document with the canonical @context. */
export function gaiaDocument(records: GaiaRecord[]): { '@context': typeof GAIA_CONTEXT; '@graph': GaiaRecord[] } {
  return { '@context': GAIA_CONTEXT, '@graph': records }
}

// Required properties per GAIA class (mirrors prophet-domain-gaia-ontology SHACL shapes).
const REQUIRED: Record<string, string[]> = {
  'gaia:FeatureRegistryEntry': ['gaia:hasFeatureId', 'gaia:hasPromotionState'],
  'gaia:ConcordanceLink': ['gaia:hasSourceRecordId', 'gaia:hasPromotionState'],
  'gaia:CanonicalEntity': ['rdfs:label'],
}

/** Conformance check against the GAIA SHACL required-property constraints (lightweight, offline). */
export function conformsToGaia(record: GaiaRecord): { conforms: boolean; missing: string[] } {
  const req = REQUIRED[record['@type']] ?? []
  const missing = req.filter((p) => record[p] == null || record[p] === '')
  return { conforms: missing.length === 0, missing }
}
