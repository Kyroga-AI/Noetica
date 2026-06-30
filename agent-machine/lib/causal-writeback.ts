/**
 * causal-writeback — persist causal DAG models into HellGraph and annotate
 * IntelligenceTask evidence steps with causal node + path metadata.
 *
 * Writes:
 *   CausalModel node  — the named DAG model (e.g. 'gyg-lfl')
 *   CausalNode nodes  — one per variable in the DAG
 *   CausalEdge atoms  — directed edges in the DAG (latent edges marked)
 *   causal_node / causal_path — annotations on EvidenceStep nodes
 *
 * Idempotent per model name. Uses the KKO bridge for upper-ontology typing.
 */
import { getHellGraph } from '@socioprophet/hellgraph'
import type { CausalDAG } from './causal-graph.js'
import { identifyCausalEffect, primaryCausalPath } from './causal-graph.js'
import { kkoClassOf } from './kko-bridge.js'

// ── CausalNode type → KKO class override ─────────────────────────────────────
const CAUSAL_KKO: Record<string, string> = {
  exogenous:  'Attribute',
  endogenous: 'Information',
  instrument: 'Information',
  hidden:     'Attribute',
  decision:   'Process',
  gate:       'SocialObject',
  financial:  'Information',
}

/** Persist a CausalDAG model into HellGraph. Idempotent. */
export function persistCausalDAG(dag: CausalDAG): { nodes: number; edges: number; skipped: number } {
  const g = getHellGraph()
  const now = new Date().toISOString()
  const modelUrn = `urn:noetica:causal:model:${dag.name}`
  let nodes = 0, edges = 0, skipped = 0

  // Model root node
  try {
    const identification = identifyCausalEffect(dag)
    g.addNode(modelUrn, ['CausalModel'], {
      name: dag.description, surface: dag.name,
      treatment: dag.treatment ?? '', outcome: dag.outcome ?? '',
      strategy: identification.strategy,
      identified: identification.identified,
      created_at: now,
    })
  } catch { skipped++ }

  // Variable nodes
  for (const n of dag.nodes) {
    const urn = `urn:noetica:causal:node:${dag.name}:${n.id}`
    try {
      const kkoClass = CAUSAL_KKO[n.type] ?? kkoClassOf(n.label)
      g.addNode(urn, ['CausalNode'], {
        name: n.label, surface: n.id, node_id: n.id,
        model: dag.name, type: n.type,
        description: n.description ?? '',
        'kko:class': kkoClass,
        'kko:iri': `https://kbpedia.org/kko/rc-/${kkoClass}`,
        created_at: now,
      })
      nodes++
      // Link to model
      g.addEdge('PART_OF', urn, modelUrn, { kind: 'causal-dag' })
    } catch { skipped++ }
  }

  // Directed edges
  for (const e of dag.edges) {
    const fromUrn = `urn:noetica:causal:node:${dag.name}:${e.from}`
    const toUrn   = `urn:noetica:causal:node:${dag.name}:${e.to}`
    try {
      g.addEdge(e.latent ? 'LATENT_CAUSES' : 'CAUSES', fromUrn, toUrn, {
        model: dag.name, latent: e.latent ?? false,
        effect: e.effect ?? 'unknown', label: e.label ?? '',
      })
      edges++
    } catch { skipped++ }
  }

  return { nodes, edges, skipped }
}

/** Annotate all EvidenceStep nodes in HellGraph for a task with their causal context.
 *  Call after completing a task that used a named DAG model. */
export function annotateCausalEvidence(
  taskId: string,
  evidenceSteps: Array<{ id: string; causal_node?: string }>,
  dagName: string,
): void {
  const g = getHellGraph()
  const { getCausalModel } = require('./causal-signal.js') as typeof import('./causal-signal.js')
  const dag = getCausalModel(dagName)
  if (!dag) return

  const primaryPath = primaryCausalPath(dag)

  for (const step of evidenceSteps) {
    if (!step.causal_node) continue
    const stepUrn = `urn:noetica:evidence:${step.id}`
    const causalNodeUrn = `urn:noetica:causal:node:${dagName}:${step.causal_node}`
    const pathToOutcome = dag.outcome
      ? primaryCausalPath(dag, step.causal_node, dag.outcome)
      : []

    try {
      // Update evidence node with causal metadata
      const gAny = g as unknown as {
        setNodeProperty?: (id: string, k: string, v: unknown) => void
        getNode: (id: string) => unknown
      }
      if (typeof gAny.setNodeProperty === 'function') {
        gAny.setNodeProperty(stepUrn, 'causal_node', step.causal_node)
        gAny.setNodeProperty(stepUrn, 'causal_dag', dagName)
        gAny.setNodeProperty(stepUrn, 'causal_path', pathToOutcome.join('→'))
        gAny.setNodeProperty(stepUrn, 'path_position', String(primaryPath.indexOf(step.causal_node)))
      }
      // Link evidence step → causal node
      g.addEdge('GROUNDS', stepUrn, causalNodeUrn, { kind: 'causal-evidence' })
    } catch { /* best-effort */ }
  }
}
