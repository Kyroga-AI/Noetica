/**
 * kko-bridge — map Noetica/HellGraph node types to KBpedia/KKO upper ontology classes.
 *
 * KBpedia (kbpedia.org) is a computable knowledge graph combining Wikipedia, Wikidata,
 * schema.org, UMBEL, GeoNames, and OpenCyc under the KKO (Knowledge Knowledge Ontology)
 * meta-ontology. KKO is anchored to the DOLCE foundational ontology (Descriptive Ontology
 * for Linguistic and Cognitive Engineering — Masolo et al., WonderWeb D18, 2003).
 *
 * This bridge provides:
 *   1. kkoClassOf(label) — resolve a HellGraph node label → KKO upper class
 *   2. kkoCensus(nodes)  — census of KKO classes over the live graph
 *   3. kkoAnnotation     — KKO annotation object for a node (for API/export)
 *   4. KBPEDIA_PREDICATES — KBpedia predicate vocabulary aligned to our CSKG dimensions
 *
 * The integration enriches the CSKG layer (cskg.ts) with formal ontological typing:
 * every entity in the graph has a computable upper class, and every relation has a
 * KBpedia-aligned predicate.
 *
 * Ref: Bergman, "KBpedia Knowledge Structure" (2016–2023); kbpedia.org.
 * Ref: DOLCE — Masolo et al., WonderWeb D18, 2003.
 */

export const KKO_NAMESPACE = 'https://kbpedia.org/kko/rc-/'
export const KBPEDIA_SCHEMA = 'https://kbpedia.org/kbp/rc-/'

/** KKO upper ontology classes (simplified from the full KBpedia hierarchy). */
export const KKO_CLASSES = [
  'Thing',          // kko:Thing — most general; everything is a Thing
  'Agent',          // kko:Agent — intentional actor: Person, Organization, AI, System
  'Information',    // kko:Information — information object: Document, Concept, Knowledge, Belief, Signal
  'Event',          // kko:Event — occurrent: Action, Observation, Turn, Interaction, Transaction
  'Attribute',      // kko:Attribute — quality/property: Score, Trust, Confidence, Status, Metric
  'Relation',       // kko:Relation — relationship between things: Edge, Link, Correspondence
  'Location',       // kko:Location — spatial entity: Place, Region, Zone, Address
  'Process',        // kko:Process — ongoing activity: Workflow, Learning, Planning, Analysis
  'SocialObject',   // kko:SocialObject — social construct: Role, Policy, Contract, Governance, Rule
  'Representation', // kko:Representation — representational entity: Graph, Model, Map, Diagram, Symbol
] as const

export type KkoClass = typeof KKO_CLASSES[number]

/** KBpedia predicate vocabulary aligned to our CSKG semantic dimensions.
 *  Maps relation labels → the canonical KBpedia predicate IRI where applicable. */
export const KBPEDIA_PREDICATES: Record<string, { iri: string; label: string; dimension: string }> = {
  // Taxonomic / classification
  'IS_A':           { iri: 'kbp:isTypeOf',       label: 'is a type of',     dimension: 'taxonomic' },
  'SUBCLASS_OF':    { iri: 'kbp:isChildOf',       label: 'is subclass of',   dimension: 'taxonomic' },
  'ABOUT_DOMAIN':   { iri: 'kbp:isAbout',         label: 'is about domain',  dimension: 'taxonomic' },
  'HAS_TOPIC':      { iri: 'kbp:hasTopic',        label: 'has topic',        dimension: 'taxonomic' },

  // Part-whole / composition
  'HAS_SKILL':      { iri: 'kbp:hasPart',         label: 'has skill',        dimension: 'part-whole' },
  'HAS_COURSE':     { iri: 'kbp:hasPart',         label: 'has course',       dimension: 'part-whole' },
  'HAS_EVIDENCE':   { iri: 'kbp:hasPart',         label: 'has evidence',     dimension: 'part-whole' },
  'PART_OF':        { iri: 'kbp:isPartOf',        label: 'is part of',       dimension: 'part-whole' },

  // Causal / dependency
  'GOVERNED_BY':    { iri: 'kbp:isConstrainedBy', label: 'is governed by',   dimension: 'causation' },
  'GROUNDS':        { iri: 'kbp:isGroundedIn',    label: 'is grounded in',   dimension: 'causation' },
  'DERIVED_IN':     { iri: 'kbp:isDerivedFrom',   label: 'is derived in',    dimension: 'causation' },
  'REMEDIATES':     { iri: 'kbp:remediates',      label: 'remediates',       dimension: 'causation' },

  // Temporal / process
  'HAS_TURN':       { iri: 'kbp:hasStep',         label: 'has turn',         dimension: 'temporal' },
  'PROGRESSES':     { iri: 'kbp:precedes',        label: 'progresses',       dimension: 'temporal' },
  'RECALLED':       { iri: 'kbp:references',      label: 'recalled',         dimension: 'temporal' },

  // Social / provenance
  'PRODUCED':       { iri: 'kbp:isCreatedBy',     label: 'produced by',      dimension: 'creation' },
  'CLAIMED_BY':     { iri: 'kbp:isAttributedTo',  label: 'claimed by',       dimension: 'social' },
  'CERTIFIED_BY':   { iri: 'kbp:isEndorsedBy',    label: 'certified by',     dimension: 'utility' },

  // Similarity / identity
  'SAME_AS':        { iri: 'kbp:isEquivalentTo',  label: 'same as',          dimension: 'similarity' },
  'RELATED_TO':     { iri: 'kbp:isRelatedTo',     label: 'related to',       dimension: 'similarity' },
  'COOCCURS_WITH':  { iri: 'kbp:coOccursWith',    label: 'co-occurs with',   dimension: 'co-occurrence' },
}

/** Explicit map from HellGraph node label → KKO upper class. */
const LABEL_TO_KKO: Record<string, KkoClass> = {
  // Knowledge / information entities
  Concept: 'Information', Knowledge: 'Information', Term: 'Information',
  Topic: 'Information', Domain: 'Information', Category: 'Information',
  Memory: 'Information', Belief: 'Information', Note: 'Information',
  Document: 'Information', Artifact: 'Information', Chunk: 'Information',
  Signal: 'Information', IntelligenceSignal: 'Information',

  // Academic brain nodes
  AcademicField: 'Information', AcademicCourse: 'Information',
  AcademicModule: 'Information',

  // Sloan brain nodes
  SloanField: 'Information', SloanCourse: 'Information',

  // Financial brain nodes
  FinancialDomain: 'Information', FinancialSkill: 'Process',
  InvestmentThesis: 'Information', FinancialSignal: 'Information',
  EarningsReport: 'Information', AnalystReport: 'Information',

  // Intelligence task nodes
  IntelligenceTask: 'Process', PolicyGate: 'SocialObject',
  EvidenceStep: 'Event', GovernanceRecord: 'SocialObject',

  // Dialogue / interaction
  Turn: 'Event', Interaction: 'Event', Action: 'Event',
  Observation: 'Event', Session: 'Event',

  // Agents / actors
  Person: 'Agent', Organization: 'Agent', Agent: 'Agent',
  User: 'Agent', Analyst: 'Agent', PortfolioManager: 'Agent',

  // Governance / GAIA ontology
  LIVING_ENTITY: 'Agent', ONTOGENESIS_STATE: 'Attribute',
  STEWARDSHIP_RECORD: 'SocialObject', KEEPER_LOG: 'Event',

  // Spatial
  Place: 'Location', Location: 'Location', Region: 'Location',

  // Graph / structural
  GraphNode: 'Representation', GraphEdge: 'Relation',
  StackModule: 'Information',

  // Social / governance
  Policy: 'SocialObject', Rule: 'SocialObject', Goal: 'SocialObject',
  Role: 'SocialObject', Contract: 'SocialObject', AuditRecord: 'SocialObject',

  // Process / operational
  Workflow: 'Process', Task: 'Process', Step: 'Process',
  Plan: 'Process', Pipeline: 'Process', Loop: 'Process',

  // Attributes / metrics
  Score: 'Attribute', Trust: 'Attribute', Confidence: 'Attribute',
  Status: 'Attribute', Quality: 'Attribute', Metric: 'Attribute',
}

/** Resolve the KKO upper class for a HellGraph node label. Keyword fallback if not in explicit map. */
export function kkoClassOf(label: string): KkoClass {
  const exact = LABEL_TO_KKO[label]
  if (exact) return exact
  const k = (label ?? '').toLowerCase()
  if (/person|agent|user|actor|owner|author|analyst|investor|manager|pm|trader/.test(k)) return 'Agent'
  if (/turn|event|action|observ|occur|interact|step|session|trade|transaction/.test(k)) return 'Event'
  if (/policy|rule|contract|governance|compliance|regulation|law|audit/.test(k)) return 'SocialObject'
  if (/place|location|region|zone|area|geo|spatial|store|branch/.test(k)) return 'Location'
  if (/workflow|process|task|plan|procedure|pipeline|loop|analysis|model/.test(k)) return 'Process'
  if (/score|trust|confidence|quality|attribute|property|status|metric|rating/.test(k)) return 'Attribute'
  if (/edge|link|relation|connection|bond|path|concordance/.test(k)) return 'Relation'
  if (/graph|map|diagram|representation|symbol|index|surface/.test(k)) return 'Representation'
  if (/document|knowledge|concept|term|text|corpus|chunk|brain|memory|note|belief|signal|thesis|report/.test(k)) return 'Information'
  return 'Thing'
}

/** The fully-qualified KKO IRI for a class name. */
export function kkoIri(cls: KkoClass): string {
  return `${KKO_NAMESPACE}${cls}`
}

/** KKO annotation object for a node (includes class + IRI). */
export function kkoAnnotation(label: string): { 'kko:class': KkoClass; 'kko:iri': string } {
  const cls = kkoClassOf(label)
  return { 'kko:class': cls, 'kko:iri': kkoIri(cls) }
}

/** Census of KKO classes over a set of {labels[], count?} entries. */
export function kkoCensus(
  nodes: Array<{ labels: string[]; count?: number }>
): Record<KkoClass, number> {
  const out: Partial<Record<KkoClass, number>> = {}
  for (const { labels, count = 1 } of nodes) {
    const primary = labels[0] ?? 'Thing'
    const cls = kkoClassOf(primary)
    out[cls] = (out[cls] ?? 0) + count
  }
  return out as Record<KkoClass, number>
}

/** Annotate all nodes in a HellGraph allNodes() result with KKO classes.
 *  Returns a map from node id → KKO class for downstream use. */
export function annotateGraph(
  nodes: Array<{ id: string; labels: string[] }>
): Map<string, KkoClass> {
  const out = new Map<string, KkoClass>()
  for (const { id, labels } of nodes) {
    out.set(id, kkoClassOf(labels[0] ?? 'Thing'))
  }
  return out
}
