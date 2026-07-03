/**
 * agent-memory.ts — the organs, wired to the skin.
 *
 * Composes the pieces built this session into one subsystem so they actually work together:
 *   isolation-policy (skin)  → decides sensitivity/namespace + a slash-topics MembraneDecision
 *   → store selection        → self/workspace stay on-device (fsMemoryStore); collective rides memory-mesh
 *   → contextual-ingest      → situate each chunk before it lands
 *   → memory-layers          → living-KB write + 5-phase autoDream consolidation
 * A DENY from the membrane refuses ingest (leakage prevention); a self-scoped item never leaves the device.
 */
import { fsMemoryStore } from './fs-memory-store.js'
import { MeshMemoryClient, meshMemoryStore, scopeEnvelopeFor } from './mesh-memory.js'
import { decideIsolation, toMembraneDecision, type MembraneDecision, type TrustNamespace } from './isolation-policy.js'
import { chunkDocument, contextualize, type Situate } from './contextual-ingest.js'
import { extractMemory, autoDream, assembleContext, grepMemory, type MemoryStore, type DreamReport } from './memory-layers.js'

export interface AgentMemoryConfig {
  identity: { user_id: string; agent_id: string; run_id: string } // for the memory-mesh ScopeEnvelope
  mesh?: MeshMemoryClient                                          // when present, the collective namespace rides the mesh
  situate?: Situate                                               // model-backed situating; default is extractive (no model)
}

export interface IngestDoc {
  name: string
  content: string
  title?: string
  labels?: string[]
  namespace?: TrustNamespace
  links?: string[]
}
export interface IngestResult {
  admitted: boolean
  membrane: MembraneDecision
  namespace: TrustNamespace
  backend: 'fs' | 'mesh'
  chunks: number
}

export class AgentMemory {
  constructor(private cfg: AgentMemoryConfig) {}

  /** self/workspace stay local (on-device); collective rides memory-mesh when a client is configured. */
  private storeFor(ns: TrustNamespace): { store: MemoryStore; backend: 'fs' | 'mesh' } {
    if (ns === 'collective' && this.cfg.mesh) {
      return { store: meshMemoryStore(this.cfg.mesh, scopeEnvelopeFor(ns, this.cfg.identity)), backend: 'mesh' }
    }
    return { store: fsMemoryStore(ns), backend: 'fs' }
  }

  /** Skin-gated, trust-scoped, contextualized ingest into the right memory organ. */
  async ingest(doc: IngestDoc): Promise<IngestResult> {
    const decision = decideIsolation({ content: doc.content, labels: doc.labels, namespace: doc.namespace })
    const membrane = toMembraneDecision(decision, { input: doc.content })
    if (membrane.decision === 'DENY') {
      return { admitted: false, membrane, namespace: decision.namespace, backend: 'fs', chunks: 0 }
    }
    const { store, backend } = this.storeFor(decision.namespace)
    const chunks = chunkDocument(doc.content)
    const situated = await contextualize(chunks, { title: doc.title, text: doc.content }, this.cfg.situate)
    const body = situated.map((c) => c.contextualized).join('\n\n')
    await extractMemory(store, {
      name: doc.name,
      body,
      links: doc.links ?? [],
      provenance: `scope:${membrane.scope}`,
      score: 1,
      updatedAt: Date.now(),
    })
    return { admitted: true, membrane, namespace: decision.namespace, backend, chunks: chunks.length }
  }

  /** grep-only recall within a trust namespace (never crosses scopes). */
  recall(namespace: TrustNamespace, query: string): Promise<string[]> {
    return grepMemory(this.storeFor(namespace).store, query)
  }

  /** the always-loaded index for a namespace (L1). */
  context(namespace: TrustNamespace): Promise<string> {
    return assembleContext(this.storeFor(namespace).store)
  }

  /** background consolidation (5-phase autoDream) scoped to a namespace. */
  consolidate(namespace: TrustNamespace): Promise<DreamReport> {
    return autoDream(this.storeFor(namespace).store)
  }

  /** does a named artifact/topic exist in this namespace? (gate check for orchestration handoffs) */
  async has(namespace: TrustNamespace, name: string): Promise<boolean> {
    return (await this.storeFor(namespace).store.readTopic(name)) !== null
  }
}
