/**
 * contextual-ingest.ts — contextual-retrieval preprocessing (Anthropic pattern).
 *
 * Before embedding, situate each chunk WITHIN its document so retrieval isn't blind to context:
 * for every chunk, produce a short situating context and prepend it → embed the contextualized chunk.
 * The `situate` fn is injected (DI): the default is a no-model EXTRACTIVE situating (doc title + nearest
 * heading), so this runs + tests offline; the real impl injects a local-model call (Ollama) that writes
 * the "50–100 tokens of context" prompt. Feeds the L2/L3 layers of the layered memory.
 */

export interface Chunk { id: string; text: string }
export interface DocContext { title?: string; text: string }
export interface ContextualChunk extends Chunk {
  context: string          // the situating preamble
  contextualized: string   // context + chunk, ready to embed
}

export type Situate = (chunk: Chunk, doc: DocContext) => string | Promise<string>

/** No-model default: prepend the doc title and the nearest preceding markdown heading. */
export const extractiveSituate: Situate = (chunk, doc) => {
  const title = doc.title ? `Document: ${doc.title}.` : ''
  const idx = doc.text.indexOf(chunk.text)
  const before = idx >= 0 ? doc.text.slice(0, idx) : ''
  const heading = [...before.matchAll(/^#{1,6}\s+(.+)$/gm)].pop()?.[1]?.trim()
  return [title, heading ? `Section: ${heading}.` : ''].filter(Boolean).join(' ')
}

/** Situate every chunk; returns contextualized chunks ready for the embedding + TF-IDF paths. */
export async function contextualize(
  chunks: Chunk[],
  doc: DocContext,
  situate: Situate = extractiveSituate,
): Promise<ContextualChunk[]> {
  const out: ContextualChunk[] = []
  for (const c of chunks) {
    const context = (await situate(c, doc)).trim()
    out.push({ ...c, context, contextualized: context ? `${context}\n${c.text}` : c.text })
  }
  return out
}

/** Split a document into overlapping chunks (simple char-window; the ingest sink re-embeds). */
export function chunkDocument(text: string, opts: { size?: number; overlap?: number } = {}): Chunk[] {
  const size = opts.size ?? 1200
  const overlap = opts.overlap ?? 150
  const chunks: Chunk[] = []
  let i = 0
  let n = 0
  while (i < text.length) {
    chunks.push({ id: `c${n++}`, text: text.slice(i, i + size) })
    if (i + size >= text.length) break
    i += size - overlap
  }
  return chunks
}
