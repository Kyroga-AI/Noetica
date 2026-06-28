/**
 * graph.ts — Process-level HellGraph singleton for the agent-machine.
 *
 * Wraps the shared HellGraphStore façade and exposes a health snapshot,
 * SPARQL query helper, and all ingest entry points used by the agent layer.
 */

import { getHellGraph, HellGraphStore } from '@socioprophet/hellgraph'
import { getAtomSpace } from '@socioprophet/hellgraph'
import { instrumentGraph } from './graph-revision.js'
import { runSparql } from '@socioprophet/hellgraph'
import type { SparqlResult } from '@socioprophet/hellgraph'
import {
  ingestInteraction,
  ingestConversation,
  ingestMessage,
  ingestEntities,
  ingestDocumentChunks,
} from '@socioprophet/hellgraph'
import type {
  InteractionFact,
  ConversationFact,
  MessageFact,
} from '@socioprophet/hellgraph'
// ─── Re-exports ───────────────────────────────────────────────────────────────

export {
  ingestInteraction,
  ingestConversation,
  ingestMessage,
  ingestEntities,
  ingestDocumentChunks,
  HellGraphStore,
}

export type { InteractionFact, ConversationFact, MessageFact, SparqlResult }

// ─── Process-level singleton accessor ────────────────────────────────────────

export function getGraph(): HellGraphStore {
  const g = getHellGraph()
  instrumentGraph(g)   // Phase-0 change capture: bump revision + record dirty ids on mutation (idempotent)
  return g
}

// ─── Health snapshot ─────────────────────────────────────────────────────────

export interface GraphHealth {
  nodeCount: number
  edgeCount: number
  orphans: number
  walPath: string
  logicalClock: number
}

export function graphHealth(): GraphHealth {
  const g = getGraph()
  return {
    nodeCount: g.nodeCount(),
    edgeCount: g.edgeCount(),
    orphans: g.orphanNodeCount(),
    walPath: getAtomSpace().storagePath,
    logicalClock: g.logicalClock,
  }
}

// ─── SPARQL query helper ──────────────────────────────────────────────────────

export function graphSparql(query: string): SparqlResult {
  return runSparql(getGraph(), query)
}
