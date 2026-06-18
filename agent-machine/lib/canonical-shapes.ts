/**
 * Canonical SHACL shapes for the HellGraph core node types. Used by the optional
 * Ontogenesis write-validation gate (NOETICA_SHACL_ENFORCE=1).
 *
 * The validator (lib/hellgraph/shacl.ts) matches sh:targetClass against the node's
 * rdf:type label and sh:path against property keys, so these shapes assert the
 * minimum well-formedness of the entities we ingest from chat.
 *
 * NOTE: the current gate is REPORT-ONLY — it surfaces violation counts, it does
 * not reject writes. Hard rejection is intentionally not enabled mid-chat.
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
  sh:property [ sh:path ex:run_id ; sh:minCount 1 ] .
`.trim()
