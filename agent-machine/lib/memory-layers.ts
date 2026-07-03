/**
 * memory-layers.ts — the Claude-Code memory pattern for the Noetica agent.
 *
 * Memory is a self-healing INDEX, not a storage dump. Three layers:
 *   L1 index      — always loaded. One-line pointers (name → topic, hook). MEMORY.md-equivalent.
 *   L2 topic      — loaded ON DEMAND. Living-KB .md docs with backlinks (Karpathy wiki pattern).
 *   L3 transcript — grep-ONLY. Never injected; searched with narrow terms.
 *
 * Write paths: manualWrite (user), extractMemory (per-turn capture), autoDream (background consolidation).
 * autoDream is 5 phases — fork(isolate) → distill/merge → conflict-resolve → prune(entropy) → index-sync —
 * so a background rewrite runs on a FORK and can't pollute live context. consolidationLock serializes dreams
 * against reads/writes. Phase implementations are injectable (the real distill wires dreaming.ts etc.), which
 * keeps this orchestrator pure + testable — the same DI style as dreaming.ts.
 */

export type Layer = 'index' | 'topic' | 'transcript'

/** L1 — a single always-loaded index line (a pointer, not the content). */
export interface MemoryPointer { name: string; topic: string; hook: string }

/** L2 — an on-demand living-KB topic doc: body + backlinks + provenance/score for consolidation. */
export interface TopicDoc {
  name: string
  body: string
  links: string[]          // backlinks to other topic names ([[name]])
  provenance?: string
  score?: number           // salience; drives prune + conflict resolution
  updatedAt: number
}

/** IO backing the three layers (filesystem, sqlite, mesh — injected). */
export interface MemoryStore {
  readIndex(): Promise<MemoryPointer[]>
  writeIndex(ptrs: MemoryPointer[]): Promise<void>
  listTopics(): Promise<string[]>
  readTopic(name: string): Promise<TopicDoc | null>
  writeTopic(doc: TopicDoc): Promise<void>
  deleteTopic(name: string): Promise<void>
  grepTranscripts(query: string): Promise<string[]>
  appendTranscript(line: string): Promise<void>
}

const firstLine = (s: string) => (s.split('\n').find((l) => l.trim()) ?? '').slice(0, 140)

// ── Read paths — Claude injects ONLY the index; topics on demand; transcripts grep-only ──
export async function assembleContext(store: MemoryStore): Promise<string> {
  const idx = await store.readIndex()
  return idx.map((p) => `- [${p.name}](${p.topic}) — ${p.hook}`).join('\n')
}
export function recallTopic(store: MemoryStore, name: string): Promise<TopicDoc | null> {
  return store.readTopic(name) // L2, on demand
}
export function grepMemory(store: MemoryStore, query: string): Promise<string[]> {
  return store.grepTranscripts(query) // L3, grep-only (narrow terms)
}

// ── Write paths ──
export async function manualWrite(store: MemoryStore, doc: TopicDoc): Promise<void> {
  await store.writeTopic({ ...doc, updatedAt: Date.now() })
  await syncIndex(store)
}
/** Per-turn capture: write the candidate topic + a transcript breadcrumb; index stays lean until a dream. */
export async function extractMemory(store: MemoryStore, doc: TopicDoc): Promise<void> {
  await store.writeTopic({ ...doc, updatedAt: Date.now() })
  await store.appendTranscript(`extracted ${doc.name}: ${firstLine(doc.body)}`)
}

// ── consolidationLock — serialize background dreams against live reads/writes (in-process mutex) ──
let _lockChain: Promise<unknown> = Promise.resolve()
export function withConsolidationLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = _lockChain.then(() => fn())
  _lockChain = run.then(() => undefined, () => undefined)
  return run
}

async function syncIndex(store: MemoryStore): Promise<MemoryPointer[]> {
  const names = await store.listTopics()
  const ptrs: MemoryPointer[] = []
  for (const n of names) {
    const t = await store.readTopic(n)
    if (t) ptrs.push({ name: t.name, topic: n, hook: firstLine(t.body) })
  }
  await store.writeIndex(ptrs)
  return ptrs
}

// ── autoDream — the 5-phase background consolidation ──
export interface DreamDeps {
  /** Phase 2: distill/merge the forked set (default: merge duplicates by name, union backlinks). */
  distill?: (docs: TopicDoc[]) => TopicDoc[]
  /** Phase 3: name-pairs in conflict (default: none). Real impl wires contradiction detection. */
  findConflicts?: (docs: TopicDoc[]) => Array<[string, string]>
  /** Phase 3: resolve a conflicting pair (default: keep higher score, union links). */
  resolveConflict?: (a: TopicDoc, b: TopicDoc) => TopicDoc
  /** Phase 4: drop predicate (default: score <= 0 — low-value/derivable). Real impl wires decay/curation. */
  prune?: (doc: TopicDoc) => boolean
}
export interface DreamReport { forked: number; merged: number; conflicts: number; pruned: number; indexed: number }

export const defaultDistill = (docs: TopicDoc[]): TopicDoc[] => {
  const byName = new Map<string, TopicDoc>()
  for (const d of docs) {
    const ex = byName.get(d.name)
    byName.set(d.name, ex
      ? { ...ex, links: [...new Set([...ex.links, ...d.links])], score: Math.max(ex.score ?? 0, d.score ?? 0), updatedAt: Math.max(ex.updatedAt, d.updatedAt) }
      : d)
  }
  return [...byName.values()]
}
const defaultResolve = (a: TopicDoc, b: TopicDoc): TopicDoc => {
  const win = (a.score ?? 0) >= (b.score ?? 0) ? a : b
  return { ...win, links: [...new Set([...a.links, ...b.links])] }
}

export function autoDream(store: MemoryStore, deps: DreamDeps = {}): Promise<DreamReport> {
  return withConsolidationLock(async () => {
    // Phase 1 — fork (isolate): snapshot topics into a working set; live store untouched until commit.
    const names = await store.listTopics()
    let work: TopicDoc[] = []
    for (const n of names) { const t = await store.readTopic(n); if (t) work.push({ ...t, links: [...t.links] }) }
    const forked = work.length

    // Phase 2 — distill / merge.
    work = (deps.distill ?? defaultDistill)(work)
    const merged = forked - work.length

    // Phase 3 — conflict resolution.
    const conflicts = (deps.findConflicts ?? (() => []))(work)
    const resolve = deps.resolveConflict ?? defaultResolve
    for (const [a, b] of conflicts) {
      const da = work.find((w) => w.name === a)
      const db = work.find((w) => w.name === b)
      if (da && db) { const win = resolve(da, db); work = work.filter((w) => w.name !== a && w.name !== b); work.push(win) }
    }

    // Phase 4 — prune (entropy control).
    const prune = deps.prune ?? ((d: TopicDoc) => (d.score ?? 1) <= 0)
    const beforePrune = work.length
    work = work.filter((d) => !prune(d))
    const pruned = beforePrune - work.length

    // Commit the fork back atomically-ish: replace topics with survivors, then Phase 5.
    for (const n of names) await store.deleteTopic(n)
    for (const d of work) await store.writeTopic({ ...d, updatedAt: Date.now() })

    // Phase 5 — index sync: rebuild L1 pointers from survivors.
    const ptrs = await syncIndex(store)
    return { forked, merged, conflicts: conflicts.length, pruned, indexed: ptrs.length }
  })
}

/** In-memory MemoryStore — for tests and the edge/one-box case. */
export function inMemoryStore(): MemoryStore {
  const topics = new Map<string, TopicDoc>()
  let index: MemoryPointer[] = []
  const transcript: string[] = []
  return {
    async readIndex() { return index },
    async writeIndex(p) { index = p },
    async listTopics() { return [...topics.keys()] },
    async readTopic(n) { return topics.get(n) ?? null },
    async writeTopic(d) { topics.set(d.name, d) },
    async deleteTopic(n) { topics.delete(n) },
    async grepTranscripts(q) { return transcript.filter((l) => l.includes(q)) },
    async appendTranscript(l) { transcript.push(l) },
  }
}
