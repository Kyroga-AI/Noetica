/**
 * graph.ts — Process-level HellGraph singleton for the agent-machine.
 *
 * Wraps the shared HellGraphStore façade and exposes a health snapshot,
 * SPARQL query helper, and all ingest entry points used by the agent layer.
 */

import { getHellGraph, HellGraphStore } from '../../lib/hellgraph/store.js'
import { runSparql } from '../../lib/hellgraph/sparql.js'
import type { SparqlResult } from '../../lib/hellgraph/sparql.js'
import {
  ingestInteraction,
  ingestConversation,
  ingestMessage,
  ingestEntities,
  ingestDocumentChunks,
} from '../../lib/hellgraph/ingest.js'
import type {
  InteractionFact,
  ConversationFact,
  MessageFact,
} from '../../lib/hellgraph/ingest.js'
import * as path from 'node:path'
import * as os from 'node:os'

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
  return getHellGraph()
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
  const walPath = path.join(
    os.homedir(),
    '.noetica',
    'hellgraph',
    'sociosphere-primary.atomspace.jsonl',
  )
  return {
    nodeCount: g.nodeCount(),
    edgeCount: g.edgeCount(),
    orphans: g.orphanNodeCount(),
    walPath,
    logicalClock: g.logicalClock,
  }
}

// ─── SPARQL query helper ──────────────────────────────────────────────────────

export function graphSparql(query: string): SparqlResult {
  return runSparql(getGraph(), query)
}
