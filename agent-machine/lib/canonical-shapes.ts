/**
 * Canonical SHACL shapes for the HellGraph core node types. Used by the optional
 * Ontogenesis write-validation gate (NOETICA_SHACL_ENFORCE=1).
 *
 * The validator (lib/hellgraph/shacl.ts) matches sh:targetClass against the node's
 * rdf:type label and sh:path against property keys, so these shapes assert the
 * minimum well-formedness of the entities we ingest from chat.
 *
 * The gate runs post-ingest (whole-graph validateGraph) and, when enforcing,
 * QUARANTINES violating entities so retrieval/reasoning ignore them — it never
 * blocks a chat. validateEntity() below is the fast per-node check (mirrors the
 * shapes) used to mark new entities.
 */
export const CANONICAL_SHAPES = `
@prefix sh: <http://www.w3.org/ns/shacl#> .
@prefix ex: <http://noetica/> .

ex:FeatureAtomShape a sh:NodeShape ;
  sh:targetClass ex:FeatureAtom ;
  sh:property [ sh:path ex:surface ; sh:minCount 1 ] ;
  sh:property [ sh:path ex:kind ; sh:minCount 1 ] .

ex:InteractionShape a sh:NodeShape ;
  sh:targetClass ex:Interaction ;
  sh:property [ sh:path ex:runId ; sh:minCount 1 ] .
`.trim()

// Required properties per node class — kept in lockstep with CANONICAL_SHAPES
// above so the fast per-entity check matches the whole-graph SHACL validation.
const REQUIRED_PROPS: Record<string, string[]> = {
  FeatureAtom: ['surface', 'kind'],
  Interaction: ['runId'],
}

/** Property key marking an entity as SHACL-quarantined (excluded from retrieval). */
export const QUARANTINE_PROP = 'shacl_quarantined'

/** Pure per-entity validation: returns the list of missing required properties
 *  for whichever shape(s) the entity's labels target. Empty array = conforms. */
export function validateEntity(labels: string[], properties: Record<string, unknown>): string[] {
  const missing: string[] = []
  for (const label of labels) {
    for (const prop of REQUIRED_PROPS[label] ?? []) {
      const v = properties[prop]
      if (v === undefined || v === null || String(v).trim() === '') missing.push(`${label}.${prop}`)
    }
  }
  return missing
}
