/**
 * Document store — real RAG over uploaded files.
 *
 * Pipeline: extract text (server-side, so binary .docx works without a browser
 * parser) → chunk → embed each chunk with nomic-embed-text → store as
 * DocumentChunk atoms in HellGraph with their vector. Retrieval embeds the query
 * and returns the top-k chunks by cosine similarity. This is the semantic layer
 * the graph/temporal/belief retrieval patterns lacked.
 */

import { createHash } from 'node:crypto'
import {
  getHellGraph, extractEntities, ingestEntities,
  putChunk as hgPutChunk, semanticSearch as hgSemanticSearch, cosineSim,
} from '@socioprophet/hellgraph'
import { embedText } from './ollama.js'
import { bm25 } from './hybrid-retrieve.js'
import { isUserDoc, collectionIdOf } from './doc-scope.js'

const CHUNK_LABEL = 'DocumentChunk'

// ─── Text extraction ────────────────────────────────────────────────────────

/**
 * Extract plain text from an uploaded file. .docx via mammoth (handles OOXML
 * zip/structure/tables robustly); .pdf rejected with a clear message; everything
 * else treated as UTF-8. Async because mammoth is.
 */
export async function extractText(filename: string, mimeType: string, buf: Buffer): Promise<string> {
  const lower = filename.toLowerCase()
  if (lower.endsWith('.docx') || mimeType.includes('officedocument.wordprocessingml')) {
    const mammoth = await import('mammoth')
    const { value } = await mammoth.extractRawText({ buffer: buf })
    return value.replace(/\n{3,}/g, '\n\n').trim()
  }
  if (lower.endsWith('.pdf') || mimeType === 'application/pdf') {
    // unpdf — pure-JS pdfjs built for bundled/serverless runtimes (zero deps, NO canvas/DOMMatrix). pdf-parse v2
    // needs @napi-rs/canvas + DOM polyfills ("DOMMatrix is not defined") and v1 does a computed require of a
    // versioned pdf.js build ("Cannot find module ./pdf.js/v1.10.100/build/pdf.js") — both break in the
    // bun-compiled standalone, so every PDF ingest failed with internal_error. unpdf bundles cleanly.
    const { extractText: pdfExtract, getDocumentProxy } = await import('unpdf')
    const doc = await getDocumentProxy(new Uint8Array(buf))
    const { text } = await pdfExtract(doc, { mergePages: true })
    const out = (typeof text === 'string' ? text : (text as string[]).join('\n')).replace(/\n{3,}/g, '\n\n').trim()
    if (!out) throw new Error('PDF has no extractable text (scanned image?) — paste the text or run OCR')
    return out
  }
  // Everything else: treat as UTF-8 text (txt, md, csv, json, code).
  return buf.toString('utf8')
}

// ─── Chunking ─────────────────────────────────────────────────────────────────

const CHUNK_SIZE = 1100
const CHUNK_OVERLAP = 150

export function chunkText(text: string): string[] {
  const clean = text.replace(/\r/g, '').trim()
  if (clean.length <= CHUNK_SIZE) return clean ? [clean] : []
  const chunks: string[] = []
  let i = 0
  while (i < clean.length) {
    let end = Math.min(i + CHUNK_SIZE, clean.length)
    // Prefer breaking on a paragraph/sentence boundary near the window end.
    if (end < clean.length) {
      const slice = clean.slice(i, end)
      const br = Math.max(slice.lastIndexOf('\n\n'), slice.lastIndexOf('. '))
      if (br > CHUNK_SIZE * 0.5) end = i + br + 1
    }
    chunks.push(clean.slice(i, end).trim())
    if (end >= clean.length) break          // reached the end — terminate (else i loops on the tail)
    const next = end - CHUNK_OVERLAP
    i = next > i ? next : end                // never move backward or stall
  }
  return chunks.filter((c) => c.length > 0)
}

// ─── Ingest ─────────────────────────────────────────────────────────────────

export interface IngestResult {
  documentId: string; filename: string; chunks: number; embedded: number; preview: string[]
  entities: number                                  // grounded entities recognized on ingest
  grounding?: { confirmed: number; residual: number } // confirmed = grounded to prime basis; residual = surprise
}

/** Link a doc to the canonical entities it mentions (GROUNDS edges), matched by normalised surface — interned
 *  entities carry no per-doc provenance. Idempotent (skips already-linked). PURE linking — never re-ingests
 *  entities (that's the expensive part); callers that need ingest do it separately. Returns edges added. */
function linkDocGrounds(g: ReturnType<typeof getHellGraph>, docId: string, ents: Array<{ normalised?: string }>): number {
  const wanted = new Set(ents.map((e) => String(e.normalised ?? '').toLowerCase().trim()).filter(Boolean))
  if (wanted.size === 0) return 0
  const already = new Set(g.out(docId, 'GROUNDS').map((n) => n.id))
  let n = 0
  for (const ce of g.nodesByLabel('CanonicalEntity')) {
    const norm = String(ce.properties['normalised'] ?? '').toLowerCase().trim()
    if (norm && wanted.has(norm) && !already.has(ce.id)) {
      try { g.addEdge('GROUNDS', docId, ce.id, { kind: 'entity', surface: String(ce.properties['surface'] ?? norm) }); already.add(ce.id); n++ } catch { /* edge best-effort */ }
    }
  }
  return n
}

/**
 * Ground a document THROUGH the ontology on ingest — the perception half of the
 * epistemic loop. extractEntities recognizes entities and reports the prime topics
 * each one supports (grounding to the existing basis); ingestEntities writes them
 * into the atomspace as CanonicalEntity atoms with TruthValues, so PLN/ECAN can then
 * revise and decay them. Entities with prime support = CONFIRMED (the ontology
 * predicted them); the rest = RESIDUAL (surprise the basis couldn't place yet).
 * This is also the fix for the UI's "0 entities" — ingest never grounded before.
 */
function groundThroughOntology(docId: string, text: string): { entities: number; confirmed: number; residual: number } {
  try {
    const ents = extractEntities(text)
    let confirmed = 0
    for (const e of ents) {
      if (e.primeSupport.length > 0 && e.confidence >= 0.5) confirmed++
    }
    // Native write into the epistemic substrate (CanonicalEntity atoms + epistemic class).
    ingestEntities(docId, 'ingest', text.slice(0, 20_000), new Date().toISOString())
    // GROUNDS linkage (P2.4): bridge the doc layer to the REGIS entity layer (matched by normalised surface).
    try { linkDocGrounds(getHellGraph(), docId, ents) } catch { /* grounding linkage best-effort */ }
    return { entities: ents.length, confirmed, residual: ents.length - confirmed }
  } catch {
    return { entities: 0, confirmed: 0, residual: 0 }
  }
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)
}

/**
 * Link a source Document to ALL its projections as EXPLICIT edges (not just a doc_id
 * property), so "this doc → its chunks/entities" is graph-traversable. This completes the
 * "one source doc links all its projections" model. Idempotent — runs once per doc.
 */
function linkProjections(g: ReturnType<typeof getHellGraph>, docId: string): { chunks: number; entities: number } {
  let chunks = 0, entities = 0
  try {
    if (g.out(docId, 'PRODUCED').length === 0) {
      for (const c of g.nodesByLabel(CHUNK_LABEL)) {
        if (c.properties['doc_id'] === docId) { g.addEdge('PRODUCED', docId, c.id, { kind: 'chunk' }); chunks++ }
      }
    } else chunks = g.out(docId, 'PRODUCED').length
    // GROUNDS edges are created in groundThroughOntology (matched by normalised surface, since interned entities
    // carry no per-doc provenance); just count them here.
    entities = g.out(docId, 'GROUNDS').length
  } catch { /* projection linking is best-effort */ }
  return { chunks, entities }
}

/** Chunk → embed → store as DocumentChunk atoms (text + vector + provenance).
 *  Content-addressed + idempotent: re-uploading identical content is a no-op
 *  (no duplicate chunks skewing retrieval). */
export async function ingestDocument(filename: string, text: string): Promise<IngestResult> {
  const g = getHellGraph()
  const hash = createHash('sha1').update(text).digest('hex').slice(0, 12)
  const docId = `urn:noetica:doc:${slug(filename)}-${hash}`
  // Already ingested this exact content? Return the existing record (idempotent).
  // Re-grounding is fine — interned atoms collapse + TruthValues revise (reinforcement).
  if (g.getNode(docId)) {
    const existing = g.nodesByLabel(CHUNK_LABEL).filter((n) => n.properties['doc_id'] === docId)
    const gr = groundThroughOntology(docId, text)
    linkProjections(g, docId)   // backfill projection edges on re-ingest of older docs
    return { documentId: docId, filename, chunks: existing.length, embedded: existing.filter((n) => String(n.properties['embedding'] ?? '')).length, preview: existing.slice(0, 2).map((n) => String(n.properties['text'] ?? '').slice(0, 120)), entities: gr.entities, grounding: { confirmed: gr.confirmed, residual: gr.residual } }
  }
  const chunks = chunkText(text)
  let embedded = 0
  const tierItems: Array<{ id: string; vec: number[]; meta: Record<string, unknown> }> = []
  for (let idx = 0; idx < chunks.length; idx++) {
    const chunk = chunks[idx]!
    const vec = await embedText(chunk)
    if (vec.length) { embedded++; tierItems.push({ id: `${docId}#${idx}`, vec, meta: { docId, filename, idx, text: chunk } }) }
    // Store via HellGraph's canonical vector pipeline (one chunk representation everywhere).
    hgPutChunk({ docId, idx, text: chunk, vec, filename })
  }
  // Dual-write to the extracted vector tier (per-collection ANN in the sidecar). Retrieval prefers it; the graph
  // atoms remain a fallback during the transition. USER docs only — keep the tier free of core/self/memory.
  if (isUserDoc(filename) && tierItems.length) {
    try { const { vecUpsert } = await import('./embed-runtime.js'); await vecUpsert(collectionIdOf(filename) ?? 'inbox', tierItems) } catch { /* vector tier best-effort */ }
  }
  // Preserve the raw source in the content-addressed blob store (so it can be re-extracted /
  // audited later) and stamp the Document atom with the hash that points to it.
  let rawHash = ''
  try { const { putBlob } = await import('./blob-store.js'); rawHash = putBlob(text).hash } catch { /* blob store best-effort */ }
  g.addNode(docId, ['Document'], { filename, chunk_count: chunks.length, created_at: new Date().toISOString(), ...(rawHash ? { raw_hash: rawHash, raw_bytes: Buffer.byteLength(text) } : {}) })
  // Ground the doc through the ontology (perception → epistemic substrate).
  const gr = groundThroughOntology(docId, text)
  // Link the source doc to ALL its projections as explicit edges (chunks + entities).
  linkProjections(g, docId)
  return { documentId: docId, filename, chunks: chunks.length, embedded, preview: chunks.slice(0, 2).map((c) => c.slice(0, 120)), entities: gr.entities, grounding: { confirmed: gr.confirmed, residual: gr.residual } }
}

// ─── Semantic retrieval ─────────────────────────────────────────────────────
// The cosine/scoring engine + the precomputed-vector "brain" import now live natively
// in HellGraph (`semantic` module). Noetica delegates to it, passing its own embedder
// (CPU-variant aware) and the NOETICA_DEMO_DOC scope — so there is ONE vector store and
// ONE search implementation. Brain injection: see scripts/inject-brain.ts → importBrainShard.

export interface ChunkHit { text: string; filename: string; score: number; docId: string; idx?: number }

/**
 * Retrieval scope (Projects). Confines document retrieval to a set of collections so a chat reads only
 * its project's knowledge base (+ its own attached docs), not the entire user corpus — this is what makes
 * "sales doesn't see finance" and "burger project doesn't see pocket-mentor" work.
 *   • `collections`  — allowed collection ids; when set, only chunks in these collections are considered.
 *   • `boost`        — a collection id (the current chat's) ranked FIRST — chat-first weighting.
 *   • `everything`   — ignore the collection restriction (the legacy global corpus), still honoring `boost`.
 * Omitting the scope entirely preserves the original global behavior (all callers that don't scope).
 */
export interface DocScope { collections?: string[]; boost?: string; everything?: boolean }

/** Is a chunk (by filename) inside the active retrieval scope? Undefined/empty/everything scope → always. */
export function chunkInScope(filename: string, scope?: DocScope): boolean {
  if (!scope || scope.everything || !scope.collections || scope.collections.length === 0) return true
  const cid = collectionIdOf(filename)
  return cid !== null && scope.collections.includes(cid)
}

/** Top-k document chunks by cosine to the query — delegated to HellGraph's vector engine. */
export async function semanticSearch(query: string, k = 5): Promise<ChunkHit[]> {
  return hgSemanticSearch(query, k, embedText, { scope: process.env['NOETICA_DEMO_DOC'] || undefined })
}

/**
 * Lexical chunk search via BM25 (IDF-weighted, TF-saturating, length-normalized) — the discriminative
 * keyword signal for ENTITY questions ("Baxter", "Helene"). BM25 beats the old term-presence COUNT: a chunk
 * matching a rare query term ("Baxter", high IDF) now outranks one matching a common term ("system", low IDF),
 * and a long chunk that merely mentions a term doesn't beat a focused short one. Feeds the RRF fusion's lexical
 * rank — the input ordering that drove retrieval quality.
 */
export function lexicalSearch(query: string, k = 15, docScope?: DocScope): ChunkHit[] {
  const g = getHellGraph()
  let nodes = g.nodesByLabel(CHUNK_LABEL).filter((n) => !n.properties['hidden'])   // skip soft-deleted (Library cleanup)
  const scope = process.env['NOETICA_DEMO_DOC']
  if (scope) {
    const f = nodes.filter((n) => String(n.properties['filename'] ?? '').toLowerCase().includes(scope.toLowerCase()))
    if (f.length > 0) nodes = f
  }
  // Project scope: confine to the in-scope collections (chat + project KB) before ranking.
  if (docScope && !docScope.everything && docScope.collections && docScope.collections.length > 0) {
    nodes = nodes.filter((n) => chunkInScope(String(n.properties['filename'] ?? ''), docScope))
  }
  if ([...new Set(query.toLowerCase().split(/\W+/).filter((t) => t.length > 2))].length === 0) return []
  // Index by node position so we can map BM25 results back to the chunk's full properties.
  const docs = nodes.map((n, i) => ({ id: String(i), text: String(n.properties['text'] ?? '') })).filter((d) => d.text)
  if (docs.length === 0) return []
  const out: ChunkHit[] = []
  for (const r of bm25(query, docs)) {
    if (r.score <= 0) break   // bm25() returns sorted desc; the rest are non-matches
    const n = nodes[Number(r.id)]!
    out.push({ text: String(n.properties['text'] ?? ''), filename: String(n.properties['filename'] ?? ''), score: r.score, docId: String(n.properties['doc_id'] ?? ''), idx: Number(n.properties['idx'] ?? 0) })
    if (out.length >= k) break
  }
  return out
}

/**
 * Hybrid reranked retrieval — the default RAG path. Fuses the semantic (embedding cosine) and
 * lexical (keyword) rankers via Reciprocal Rank Fusion + an exact-term-overlap boost, and attaches
 * a PER-CHUNK citation (filename#chunkIndex) to each result. Beats single-stage cosine top-k (the
 * field's #1 RAG complaint) using signals Noetica already has. Returns reranked chunks; callers
 * inject `text` and surface `citation` as provenance.
 */
export async function searchDocsReranked(query: string, limit = 8, opts: { relevanceQuery?: string; scope?: DocScope } = {}): Promise<import('./rag-rerank.js').RankedChunk[]> {
  const { fuseRerank } = await import('./rag-rerank.js')
  const semantic = await tierSemanticSearch(query, Math.max(limit, 8), opts.scope)
  // RELEVANCE GATE: if even the best chunk isn't semantically close, the docs don't cover this query — return
  // nothing so the model answers from its own knowledge instead of parroting off-topic passages. Fixes the
  // "who was the first president → quotes a business doc" derail. Gate on the RAW user query (relevanceQuery)
  // because `query` may be glossary-EXPANDED (raw + domain terms), which inflates similarity to in-corpus docs
  // and would let an off-topic question slip through. Measured: on-topic ≈0.68-0.71, off-topic ≈0.52-0.56.
  const floor = Number(process.env['NOETICA_DOC_RELEVANCE_FLOOR'] ?? '0.62')
  const gateHits = opts.relevanceQuery && opts.relevanceQuery !== query ? await tierSemanticSearch(opts.relevanceQuery, 3, opts.scope) : semantic
  const topSemantic = gateHits.reduce((m, h) => Math.max(m, h.score), 0)
  if (gateHits.length > 0 && topSemantic < floor) return []
  const lexical = lexicalSearch(query, Math.max(limit * 2, 16), opts.scope)
  // Chat-first weighting: fuse a bit wider, then float the current chat's own docs (boost collection)
  // to the top before slicing — the chat's attached sources outrank the shared project KB.
  const boost = opts.scope?.boost
  const ranked = fuseRerank(semantic, lexical, query, { limit: boost ? Math.max(limit * 2, 12) : limit })
  if (!boost) return ranked
  const first = ranked.filter((r) => collectionIdOf(r.filename) === boost)
  const rest = ranked.filter((r) => collectionIdOf(r.filename) !== boost)
  return [...first, ...rest].slice(0, limit)
}

/** Semantic ranker backed by the EXTRACTED vector tier (per-collection ANN in the sidecar): query each user
 *  collection, merge by score. Falls back to the in-graph semanticSearch when the tier is empty/unavailable —
 *  so retrieval is correct before/after migration (dual-read). */
async function tierSemanticSearch(query: string, k: number, docScope?: DocScope): Promise<ChunkHit[]> {
  // Fallback path (in-graph search) with a scope post-filter — used when the ANN tier is empty/unavailable.
  const scopedGraph = async (kk: number): Promise<ChunkHit[]> => {
    const scoped = docScope && !docScope.everything && docScope.collections && docScope.collections.length > 0
    const base = await semanticSearch(query, scoped ? Math.max(kk * 4, kk) : kk)  // over-fetch, then filter to scope
    return scoped ? base.filter((h) => chunkInScope(h.filename, docScope)).slice(0, kk) : base
  }
  try {
    const { vecQuery, vecStats } = await import('./embed-runtime.js')
    let cols = (await vecStats()).map((c) => c.name)
    // Project scope: query ONLY the in-scope collections' ANN indexes (the vector tier partitions by
    // collection id, so this is both correct and cheaper than fanning out across the whole corpus).
    if (docScope && !docScope.everything && docScope.collections && docScope.collections.length > 0) {
      const allow = new Set(docScope.collections)
      cols = cols.filter((c) => allow.has(c))
    }
    if (cols.length === 0) return scopedGraph(k)                      // tier empty / nothing in scope → graph
    const merged = (await Promise.all(cols.map((c) => vecQuery(c, { text: query, k })))).flat()
    if (merged.length === 0) return scopedGraph(k)
    const hits: ChunkHit[] = merged
      .map((h) => ({ text: String(h.meta['text'] ?? ''), filename: String(h.meta['filename'] ?? ''), score: h.score, docId: String(h.meta['docId'] ?? ''), idx: Number(h.meta['idx'] ?? 0) }))
      .filter((h) => h.text && chunkInScope(h.filename, docScope))
      .sort((a, b) => b.score - a.score)
      .slice(0, k)
    return hits.length ? hits : scopedGraph(k)
  } catch { return scopedGraph(k) }
}

export interface ChartHit extends ChunkHit {
  chart: string       // the document (chart) this section came from
  localZ: number      // standardized score WITHIN its chart — recovers flat-global signal
  chartScore: number  // chart-level relevance (mean of its top sections)
}

/**
 * Sheaf-style charted retrieval — the fix for the "0.51 plateau" (a flat global
 * embedding space holding multiple domains collapses every cosine to the noise
 * floor). Instead of one global ranking it: (1) groups chunks by document = CHART,
 * (2) scores each chart, (3) selects the covering charts for the query, (4) ranks
 * sections by their LOCAL z-score within their chart — a section that's globally
 * 0.55-vs-0.51 noise but locally +2σ in its doc is the real signal — then (5) GLUES
 * the local sections with provenance. "Meaning is local; rank in the chart, then glue."
 */
export async function sheafSearch(query: string, opts: { charts?: number; k?: number } = {}): Promise<ChartHit[]> {
  const maxCharts = opts.charts ?? 3
  const k = opts.k ?? 6
  const g = getHellGraph()
  let nodes = g.nodesByLabel(CHUNK_LABEL).filter((n) => !n.properties['hidden'])   // skip soft-deleted (Library cleanup)
  const scope = process.env['NOETICA_DEMO_DOC']
  if (scope) {
    const f = nodes.filter((n) => String(n.properties['filename'] ?? '').toLowerCase().includes(scope.toLowerCase()))
    if (f.length > 0) nodes = f
  }
  if (nodes.length === 0) return []

  const qvec = await embedText(query)
  const qTerms = new Set(query.toLowerCase().split(/\W+/).filter((t) => t.length > 2))

  // 1) hybrid-score every section (semantic cosine + lexical term coverage), by chart
  type Raw = { text: string; filename: string; docId: string; score: number }
  const byChart = new Map<string, Raw[]>()
  for (const n of nodes) {
    const text = String(n.properties['text'] ?? ''); if (!text) continue
    const docId = String(n.properties['doc_id'] ?? 'unknown')
    let sem = 0
    const raw = String(n.properties['embedding'] ?? '')
    if (raw && qvec.length) { try { sem = cosineSim(qvec, JSON.parse(raw) as number[]) } catch { /* lexical only */ } }
    const lc = text.toLowerCase()
    let lex = 0; for (const t of qTerms) if (lc.includes(t)) lex++
    // Lexical-dominant hybrid: when the embedding distribution is flat (the 0.51
    // plateau), cosine is noise and z-scoring it amplifies noise. Exact term coverage
    // is the signal that actually discriminates — especially for entity questions
    // ("Baxter", "Helene"). Semantic rides as a minor tiebreak.
    const score = (qTerms.size ? lex / qTerms.size : 0) + 0.3 * sem
    if (!byChart.has(docId)) byChart.set(docId, [])
    byChart.get(docId)!.push({ text, filename: String(n.properties['filename'] ?? ''), docId, score })
  }

  // 2) per-chart distribution + relevance (mean of the chart's top sections)
  type Chart = { filename: string; mean: number; sd: number; chartScore: number; chunks: Raw[] }
  const charts: Chart[] = []
  for (const chunks of byChart.values()) {
    const s = chunks.map((c) => c.score)
    const mean = s.reduce((a, b) => a + b, 0) / s.length
    const sd = Math.sqrt(s.reduce((a, b) => a + (b - mean) ** 2, 0) / s.length) || 1e-6
    const top = [...s].sort((a, b) => b - a).slice(0, 3)
    charts.push({ filename: chunks[0]!.filename, mean, sd, chartScore: top.reduce((a, b) => a + b, 0) / top.length, chunks })
  }

  // 3) covering family: the charts that actually cover this query
  charts.sort((a, b) => b.chartScore - a.chartScore)
  const covering = charts.slice(0, maxCharts)

  // 4) local z within each covering chart, then 5) glue with provenance
  const glued: ChartHit[] = []
  for (const c of covering) {
    for (const ch of c.chunks) {
      const localZ = (ch.score - c.mean) / c.sd
      glued.push({ text: ch.text, filename: ch.filename, score: ch.score, docId: ch.docId, chart: c.filename, localZ: Number(localZ.toFixed(2)), chartScore: Number(c.chartScore.toFixed(3)) })
    }
  }
  // chart relevance gates; local distinctiveness orders within the covering set
  glued.sort((a, b) => (b.chartScore + b.localZ) - (a.chartScore + a.localZ))
  return glued.slice(0, k)
}

export function documentChunkCount(): number {
  return getHellGraph().nodesByLabel(CHUNK_LABEL).length
}

// USER-uploaded chunks only — anything NOT in a core/protected scope (memory/knowledge/self/repo/…, see
// doc-scope.ts). Core docs (e.g. the self-model construction repos) live in the SAME physical AtomSpace, so a
// raw count makes hasDoc permanently true and routes every question into strict doc-QA ("answer ONLY from these
// sources") — refusing general knowledge. hasDoc must reflect real user uploads (collections), not core scopes.
export function userDocumentChunkCount(): number {
  return getHellGraph().nodesByLabel(CHUNK_LABEL).filter((n) => isUserDoc(String(n.properties['filename'] ?? ''))).length
}

/** Sample up to `n` text chunks from user-uploaded documents (not core scopes).
 *  Used for audio-overview generation where we want breadth over all user docs. */
export function sampleUserChunks(n = 12): string[] {
  const nodes = getHellGraph().nodesByLabel(CHUNK_LABEL)
    .filter((nd) => !nd.properties['hidden'] && isUserDoc(String(nd.properties['filename'] ?? '')))
  // Spread evenly: take every k-th chunk so we cover multiple docs
  const step = Math.max(1, Math.floor(nodes.length / n))
  const out: string[] = []
  for (let i = 0; i < nodes.length && out.length < n; i += step) {
    const t = String(nodes[i]!.properties['text'] ?? '').trim()
    if (t) out.push(t)
  }
  return out
}

/** Soft-delete a collection (the graph has no node removal): mark its Document + DocumentChunk atoms hidden so
 *  they drop out of retrieval AND the Library, without destroying provenance. Matches the collection/<id>/
 *  filename namespace. Returns how many were hidden. (Core scopes can't be targeted — callers gate on kind.) */
export function hideCollection(collectionId: string): { docs: number; chunks: number } {
  const g = getHellGraph()
  const prefix = `collection/${collectionId}/`
  const gx = g as unknown as { setNodeProperty: (id: string, key: string, value: unknown) => void }
  let docs = 0, chunks = 0
  for (const d of g.nodesByLabel('Document')) {
    if (String(d.properties['filename'] ?? '').startsWith(prefix)) { try { gx.setNodeProperty(d.id, 'hidden', true); docs++ } catch { /* */ } }
  }
  for (const c of g.nodesByLabel(CHUNK_LABEL)) {
    if (String(c.properties['filename'] ?? '').startsWith(prefix)) { try { gx.setNodeProperty(c.id, 'hidden', true); chunks++ } catch { /* */ } }
  }
  // Drop the collection from the extracted vector tier too (real delete — the index supports it). Fire-and-forget.
  void import('./embed-runtime.js').then((m) => m.vecDelete(collectionId)).catch(() => {})
  return { docs, chunks }
}

/** Migration: backfill the vector tier from existing graph DocumentChunk atoms (user docs only), reusing their
 *  stored embeddings. Idempotent (upsert-by-id). Run once on boot when the tier is empty. */
export async function reindexVectorTier(): Promise<{ collections: number; chunks: number }> {
  const g = getHellGraph()
  const { vecUpsert } = await import('./embed-runtime.js')
  const byCol = new Map<string, Array<{ id: string; vec: number[]; meta: Record<string, unknown> }>>()
  for (const n of g.nodesByLabel(CHUNK_LABEL)) {
    if (n.properties['hidden']) continue
    const filename = String(n.properties['filename'] ?? '')
    if (!isUserDoc(filename)) continue
    const raw = String(n.properties['embedding'] ?? '')
    if (!raw) continue
    let vec: number[]; try { vec = JSON.parse(raw) as number[] } catch { continue }
    if (!Array.isArray(vec) || vec.length === 0) continue
    const docId = String(n.properties['doc_id'] ?? '')
    const idx = Number(n.properties['idx'] ?? 0)
    const col = collectionIdOf(filename) ?? 'inbox'
    if (!byCol.has(col)) byCol.set(col, [])
    byCol.get(col)!.push({ id: `${docId}#${idx}`, vec, meta: { docId, filename, idx, text: String(n.properties['text'] ?? '') } })
  }
  let chunks = 0
  for (const [col, items] of byCol) { const n = await vecUpsert(col, items); if (n) chunks += n }
  return { collections: byCol.size, chunks }
}

/** Backfill GROUNDS edges for EXISTING docs that have none (new ingests link at ingest time). Reconstructs each
 *  doc's text from its chunks, re-runs the ontology grounding (idempotent), and links by normalised surface.
 *  Run once on boot; skips docs already linked. */
export function relinkDocEntities(): { docs: number; edges: number } {
  const g = getHellGraph()
  const textByDoc = new Map<string, string[]>()
  for (const c of g.nodesByLabel(CHUNK_LABEL)) {
    if (c.properties['hidden']) continue
    const did = String(c.properties['doc_id'] ?? ''); if (!did) continue
    const t = String(c.properties['text'] ?? ''); if (!t) continue
    if (!textByDoc.has(did)) textByDoc.set(did, [])
    textByDoc.get(did)!.push(t)
  }
  let docs = 0, edges = 0
  for (const d of g.nodesByLabel('Document')) {
    if (d.properties['hidden']) continue
    if (g.out(d.id, 'GROUNDS').length > 0) continue   // already linked
    const parts = textByDoc.get(d.id); if (!parts || parts.length === 0) continue
    // Link ONLY (extractEntities is cheap regex; the entities already exist from the original ingest) — never
    // re-ingest here, that's what froze the boot on a large graph.
    const e = linkDocGrounds(g, d.id, extractEntities(parts.join('\n')))
    if (e > 0) { docs++; edges += e }
  }
  return { docs, edges }
}

/** Self-healing: if stored chunk vectors were made by a DIFFERENT embedder than the one now active (different
 *  dimension — e.g. an upgrade from Ollama nomic-768 to Rust bge-384), reindex the corpus so queries + chunks
 *  share a space again. Runs once at boot in the background; a no-op when dims already match. */
export async function reindexIfDimMismatch(): Promise<{ reindexed: boolean; reason: string }> {
  const g = getHellGraph()
  const sample = g.nodesByLabel(CHUNK_LABEL).find((n) => String(n.properties['embedding'] ?? ''))
  if (!sample) return { reindexed: false, reason: 'no embedded chunks' }
  let storedDim = 0
  try { storedDim = (JSON.parse(String(sample.properties['embedding'])) as number[]).length } catch { return { reindexed: false, reason: 'unreadable embedding' } }
  const probe = await embedText('dimension probe')
  if (!probe.length) return { reindexed: false, reason: 'embedder unavailable' }
  if (probe.length === storedDim) return { reindexed: false, reason: `dims match (${storedDim})` }
  console.log(`[doc-store] embedder dim changed (${storedDim} → ${probe.length}) — reindexing corpus in background`.replace(/[\r\n]/g, ' '))
  const r = await reindexDocVectors()
  return { reindexed: true, reason: `reindexed ${r.reembedded}/${r.total} chunks ${storedDim}→${probe.length}` }
}

/** Re-embed every DocumentChunk with the CURRENT embedder (embedText) and upsert it — used after switching
 *  embedders (e.g. Ollama nomic-768 → Rust bge-384) so stored chunk vectors share the query's vector space.
 *  Idempotent + restartable; returns counts. Skips chunks with no text. */
export async function reindexDocVectors(): Promise<{ total: number; reembedded: number; failed: number }> {
  const g = getHellGraph()
  const chunks = g.nodesByLabel(CHUNK_LABEL)
  let reembedded = 0, failed = 0
  for (const n of chunks) {
    const text = String(n.properties['text'] ?? '')
    if (!text) { failed++; continue }
    const docId = String(n.properties['doc_id'] ?? '')
    const idx = Number(n.properties['idx'] ?? 0)
    const filename = String(n.properties['filename'] ?? '')
    const vec = await embedText(text)
    if (vec.length) { hgPutChunk({ docId, idx, text, vec, filename }); reembedded++ } else failed++
  }
  return { total: chunks.length, reembedded, failed }
}
