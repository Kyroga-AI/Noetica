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
import { getHellGraph } from '@socioprophet/hellgraph'
import { embedText, cosineSim } from './ollama.js'

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
    const { PDFParse } = await import('pdf-parse')
    const parser = new PDFParse({ data: new Uint8Array(buf) })
    try {
      const { text } = await parser.getText()
      const out = (text ?? '').replace(/\n{3,}/g, '\n\n').trim()
      if (!out) throw new Error('PDF has no extractable text (scanned image?) — paste the text or run OCR')
      return out
    } finally {
      await parser.destroy().catch(() => {})
    }
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

export interface IngestResult { documentId: string; filename: string; chunks: number; embedded: number; preview: string[] }

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)
}

/** Chunk → embed → store as DocumentChunk atoms (text + vector + provenance).
 *  Content-addressed + idempotent: re-uploading identical content is a no-op
 *  (no duplicate chunks skewing retrieval). */
export async function ingestDocument(filename: string, text: string): Promise<IngestResult> {
  const g = getHellGraph()
  const hash = createHash('sha1').update(text).digest('hex').slice(0, 12)
  const docId = `urn:noetica:doc:${slug(filename)}-${hash}`
  // Already ingested this exact content? Return the existing record (idempotent).
  if (g.getNode(docId)) {
    const existing = g.nodesByLabel(CHUNK_LABEL).filter((n) => n.properties['doc_id'] === docId)
    return { documentId: docId, filename, chunks: existing.length, embedded: existing.filter((n) => String(n.properties['embedding'] ?? '')).length, preview: existing.slice(0, 2).map((n) => String(n.properties['text'] ?? '').slice(0, 120)) }
  }
  const chunks = chunkText(text)
  let embedded = 0
  for (let idx = 0; idx < chunks.length; idx++) {
    const chunk = chunks[idx]!
    const vec = await embedText(chunk)
    if (vec.length) embedded++
    g.addNode(`${docId}:chunk:${idx}`, [CHUNK_LABEL], {
      text: chunk,
      embedding: vec.length ? JSON.stringify(vec) : '',
      doc_id: docId,
      filename,
      chunk_index: idx,
      created_at: new Date().toISOString(),
    })
  }
  g.addNode(docId, ['Document'], { filename, chunk_count: chunks.length, created_at: new Date().toISOString() })
  return { documentId: docId, filename, chunks: chunks.length, embedded, preview: chunks.slice(0, 2).map((c) => c.slice(0, 120)) }
}

// ─── Semantic retrieval ─────────────────────────────────────────────────────

export interface ChunkHit { text: string; filename: string; score: number; docId: string }

/**
 * Top-k document chunks by cosine similarity to the query embedding. Falls back to
 * lexical (token-overlap) scoring for any chunk that lacks an embedding so retrieval
 * still works if embeddings were unavailable at ingest.
 */
export async function semanticSearch(query: string, k = 5): Promise<ChunkHit[]> {
  const g = getHellGraph()
  const nodes = g.nodesByLabel(CHUNK_LABEL)
  if (nodes.length === 0) return []
  const qvec = await embedText(query)
  const qTokens = new Set(query.toLowerCase().split(/\W+/).filter((t) => t.length > 2))

  const scored: ChunkHit[] = []
  for (const n of nodes) {
    const text = String(n.properties['text'] ?? '')
    if (!text) continue
    const raw = String(n.properties['embedding'] ?? '')
    let score = 0
    if (raw && qvec.length) {
      try { score = cosineSim(qvec, JSON.parse(raw) as number[]) } catch { /* fall through */ }
    }
    if (score === 0) {
      // Lexical fallback: Jaccard-ish token overlap.
      const cTokens = new Set(text.toLowerCase().split(/\W+/).filter((t) => t.length > 2))
      let overlap = 0
      for (const t of qTokens) if (cTokens.has(t)) overlap++
      score = qTokens.size ? overlap / qTokens.size * 0.5 : 0 // scaled below semantic
    }
    scored.push({ text, filename: String(n.properties['filename'] ?? ''), score, docId: String(n.properties['doc_id'] ?? '') })
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, k).filter((h) => h.score > 0.05)
}

export function documentChunkCount(): number {
  return getHellGraph().nodesByLabel(CHUNK_LABEL).length
}
