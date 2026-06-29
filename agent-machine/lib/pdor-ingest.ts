/**
 * pdor-ingest.ts — the integration capstone of the Knowledge Commons onboarding pipeline. Given an approved PDOR
 * (+ its characterization + SynapseIQ enrichment), build the CATALOG NODE and PROVENANCE EDGES for HellGraph as
 * governed proposals: asset -> PDOR -> license -> file -> Terms -> entities. This is where onboarding becomes
 * INTEGRATION — the asset enters the graph linked, classified, and accountable.
 *
 * Gated by the ingest key: nothing enters the graph unless evaluatePdor issued a key (self-certified open, or a
 * fully-approved licensed/restricted/published asset). The asset node carries the moat-safe flags
 * (brainEligible / segmented) so the brain-build can filter — a segmented asset is queryable in the graph but
 * never trained on. Pure (proposals only); the caller persists via graph-writeback.persistProposals.
 */

import { proposal } from './graph-proposals.js'
import type { GraphProposal } from './graph-proposals.js'
import { enrichmentToTriples, type SynapseEnrichment } from './synapseiq-enrich.js'
import { triplesToProposals } from './auto-kg.js'
import type { Pdor, PdorDecision } from './data-onboarding.js'
import type { Characterization } from './characterization.js'

export interface IngestInputs {
  characterization?: Characterization
  enrichment?: SynapseEnrichment
  fileUri?: string
}

export interface CatalogGraph {
  assetId: string
  proposals: GraphProposal[]
  ingested: boolean       // false when no key was issued (declined / bookmark / needs-review)
}

/**
 * Build the catalog node + provenance/linkage edges for an onboarded asset as governed proposals. Returns no
 * proposals (ingested:false) when the decision carries no ingest key — the graph never holds an un-approved asset.
 */
export function buildCatalogGraph(pdor: Pdor, decision: PdorDecision, inputs: IngestInputs = {}): CatalogGraph {
  const assetId = `asset:${pdor.id}`
  if (!decision.ingestKey) return { assetId, proposals: [], ingested: false }

  const src = 'pdor-ingest'
  // The ingest KEY is the governance gate: an open asset self-certified, a licensed/restricted one passed full
  // review (evaluatePdor only issues a key once every verdict approved). So catalog proposals are ACCEPTED —
  // they persist directly; there is no second review round. accept() also tags `source` for a clean audit trail.
  const accept = (op: Parameters<typeof proposal>[0], payload: Record<string, unknown>, rationale: string): GraphProposal =>
    ({ ...proposal(op, payload, rationale, src), status: 'accepted' })
  const P: GraphProposal[] = []
  const c = inputs.characterization

  // 1. the asset node — carries the moat-safe brain flags + tier + license + quality + (folded) profile, so the
  //    brain-build can filter (segmented asset = queryable in the graph, never trained). `label` is the display name.
  P.push(accept('add-node', {
    id: assetId, kind: 'CommonsAsset', label: pdor.source.name, name: pdor.source.name,
    tier: decision.tier, openness: decision.openness,
    brainEligible: decision.brainEligible, segmented: decision.segmented,
    license: pdor.license.type, quality: c?.quality ?? null,
    ...(c ? { rows: c.rows, cols: c.cols, hasPII: c.sensitive.hasPII, hasGeo: c.geospatial.hasGeo, hasTemporal: c.temporal.hasTemporal } : {}),
  }, `cataloged ${decision.tier} asset (${decision.brainEligible ? 'brain-eligible' : 'SEGMENTED'})`))

  // 2. the PDOR record node + provenance edge.
  const pdorNode = `pdor:${pdor.id}`
  P.push(accept('add-node', { id: pdorNode, kind: 'PDOR', label: `PDOR ${pdor.id}`, requester: pdor.requester, intent: pdor.intent, status: decision.status }, 'onboarding request record'))
  P.push(accept('add-edge', { from: assetId, to: pdorNode, rel: 'requested_via' }, 'asset provenance head'))

  // 3. license node + edge (the asset is traceable to its license).
  P.push(accept('add-edge', { from: assetId, to: `license:${pdor.license.type}`, rel: 'licensed_under' }, `license ${pdor.license.type}`))

  // 4. physical file edge (where it landed).
  if (inputs.fileUri) P.push(accept('add-edge', { from: assetId, to: `file:${inputs.fileUri}`, rel: 'stored_as' }, 'physical file in the lake'))

  // 5. governance rules as governed_by edges (segment-from-brain, attribute-on-use, ...).
  for (const rule of decision.rules) P.push(accept('add-edge', { from: assetId, to: `rule:${rule}`, rel: 'governed_by' }, 'governance rule'))

  // 6. classification Terms from characterization (geo / temporal / sensitive) → classified_as edges.
  if (c) {
    if (c.geospatial.hasGeo) P.push(accept('add-edge', { from: assetId, to: 'term:geospatial', rel: 'classified_as' }, 'has geospatial structure'))
    if (c.temporal.hasTemporal) P.push(accept('add-edge', { from: assetId, to: 'term:temporal', rel: 'classified_as' }, 'has temporal structure'))
    if (c.sensitive.hasPII) P.push(accept('add-edge', { from: assetId, to: 'term:sensitive', rel: 'classified_as' }, 'contains sensitive data'))
  }

  // 7. entity linkage from SynapseIQ enrichment (asset contains symbol; symbol is_a kind). triplesToProposals
  //    tags its own auto-kg source — re-tag to 'pdor-ingest' + ACCEPT so the catalog write is one audit trail.
  if (inputs.enrichment && inputs.enrichment.symbols.length) {
    P.push(...triplesToProposals(enrichmentToTriples(assetId, inputs.enrichment), assetId).map((p) => ({ ...p, source: src, status: 'accepted' as const })))
  }

  return { assetId, proposals: P, ingested: true }
}

/** Convenience: the full ingest record for the route response (decision + the catalog graph). */
export interface IngestRecord { decision: PdorDecision; catalog: CatalogGraph }
