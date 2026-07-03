/**
 * mesh-memory.ts — conform the layered memory to the canonical distributed memory
 * (SocioProphet/memory-mesh: memoryd service + MemoryMeshClient). We DON'T reimplement memory —
 * this is a client to /v1/{recall,write,config} that maps our layered-memory writes onto memory-mesh's
 * ScopeEnvelope + recall model, so the Claude-pattern memory rides the real distributed store.
 *
 * memory-mesh is RECALL-oriented (append + vector recall), so `meshMemoryStore` implements write + grep
 * faithfully and keyed read/list best-effort via recall; pair it with `fsMemoryStore` for the local keyed
 * L1 index / L2 topics. The trust namespace maps to the ScopeEnvelope so isolation is preserved end-to-end.
 */
import type { MemoryStore, MemoryPointer, TopicDoc } from './memory-layers.js'
import type { TrustNamespace } from './isolation-policy.js'

// —— conformant to memory-mesh/adapters/openclaw-memory-mesh/src/memoryMeshClient.ts ——
export interface ScopeEnvelope {
  user_id: string
  agent_id: string
  run_id: string
  workload_id: string
  workspace_id?: string | null
  channel?: string | null
  thread_id?: string | null
  source_interface: string
  metadata?: Record<string, unknown>
}
export interface MemoryHit { memory_id: string; text: string; score: number; source: string; scope: string; tags?: string[]; metadata?: Record<string, unknown> }
export interface RecallPayload { envelope: ScopeEnvelope; query: string; top_k?: number; scope_order?: string[]; filters?: Record<string, unknown> }
export interface RecallResponse { query: string; hits: MemoryHit[]; compiled_policy: unknown }
export interface WritePayload { envelope: ScopeEnvelope; content: string; memoryClass: string; metadata?: Record<string, unknown>; tags?: string[] }
export interface WriteResponse { event_id: string; backend_memory_ids?: string[]; stored_locally?: boolean }

// minimal fetch shape (injectable for tests)
export type Fetchish = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; statusText: string; json: () => Promise<unknown> }>

export class MeshMemoryClient {
  constructor(private baseUrl: string, private apiKey = '', private fetchImpl: Fetchish = fetch as unknown as Fetchish) {}
  private get headers() { const h: Record<string, string> = { 'Content-Type': 'application/json' }; if (this.apiKey) h['X-API-Key'] = this.apiKey; return h }
  private url(p: string) { return `${this.baseUrl.replace(/\/$/, '')}${p}` }

  async recall(payload: RecallPayload): Promise<RecallResponse> {
    const r = await this.fetchImpl(this.url('/v1/recall'), { method: 'POST', headers: this.headers, body: JSON.stringify(payload) })
    if (!r.ok) throw new Error(`memory recall failed: ${r.status} ${r.statusText}`)
    return (await r.json()) as RecallResponse
  }
  async write(payload: WritePayload): Promise<WriteResponse> {
    const r = await this.fetchImpl(this.url('/v1/write'), { method: 'POST', headers: this.headers, body: JSON.stringify(payload) })
    if (!r.ok) throw new Error(`memory write failed: ${r.status} ${r.statusText}`)
    return (await r.json()) as WriteResponse
  }
}

/** Map a trust namespace + base identity to a memory-mesh ScopeEnvelope (self stays user-scoped). */
export function scopeEnvelopeFor(
  ns: TrustNamespace,
  base: { user_id: string; agent_id: string; run_id: string; workspace_id?: string; source_interface?: string },
): ScopeEnvelope {
  return {
    user_id: base.user_id,
    agent_id: base.agent_id,
    run_id: base.run_id,
    workload_id: `noetica.memory.${ns}`,
    workspace_id: ns === 'self' ? null : base.workspace_id ?? null,
    source_interface: base.source_interface ?? 'noetica-agent',
    metadata: { trust_namespace: ns, scope: ns === 'collective' ? 'global_platform' : 'user_local' },
  }
}

/**
 * A MemoryStore backed by memory-mesh. write + grep are faithful; keyed read/list are best-effort via
 * recall; the L1 index is a LOCAL concern (use fsMemoryStore for it) so index ops are no-ops here.
 */
export function meshMemoryStore(client: MeshMemoryClient, envelope: ScopeEnvelope): MemoryStore {
  const hitToTopic = (h: MemoryHit): TopicDoc => ({
    name: String(h.metadata?.name ?? h.memory_id),
    body: h.text,
    links: Array.isArray(h.tags) ? h.tags : [],
    score: typeof h.metadata?.score === 'number' ? (h.metadata.score as number) : h.score,
    provenance: h.source,
    updatedAt: typeof h.metadata?.updatedAt === 'number' ? (h.metadata.updatedAt as number) : 0,
  })
  return {
    async readIndex(): Promise<MemoryPointer[]> { return [] },                 // L1 index is local (fsMemoryStore)
    async writeIndex(): Promise<void> { /* local concern — no-op on the mesh */ },
    async listTopics(): Promise<string[]> {
      const r = await client.recall({ envelope, query: '*', top_k: 200, filters: { memoryClass: 'topic' } })
      return [...new Set(r.hits.map((h) => String(h.metadata?.name ?? h.memory_id)))]
    },
    async readTopic(name): Promise<TopicDoc | null> {
      const r = await client.recall({ envelope, query: name, top_k: 1, filters: { memoryClass: 'topic', name } })
      return r.hits[0] ? hitToTopic(r.hits[0]) : null
    },
    async writeTopic(doc): Promise<void> {
      await client.write({ envelope, content: doc.body, memoryClass: 'topic', tags: doc.links, metadata: { name: doc.name, score: doc.score, provenance: doc.provenance, updatedAt: doc.updatedAt } })
    },
    async deleteTopic(): Promise<void> { /* memory-mesh is append-only; deletion is a retention-policy concern */ },
    async grepTranscripts(query): Promise<string[]> {
      const r = await client.recall({ envelope, query, filters: { memoryClass: 'transcript' } })
      return r.hits.map((h) => h.text)
    },
    async appendTranscript(line): Promise<void> {
      await client.write({ envelope, content: line, memoryClass: 'transcript' })
    },
  }
}
