/**
 * raptor-runtime.ts — production wiring for RAPTOR: binds the tested, model-agnostic tree core (raptor.ts) to
 * the real local stack — embedBatchLocal (nomic-embed) for embeddings and generateOllamaText for cluster
 * summaries. Use for summarize-intent / global "what does the whole corpus say about X" queries, where leaf-chunk
 * retrieval structurally can't answer (the answer is spread across chunks). The tree is built once per corpus and
 * cached; retrieval is a cheap cosine over the collapsed tree.
 */
import { buildRaptorTree, collapsedRetrieve, type Embedder, type Summarizer, type RaptorTree, type RaptorNode } from './raptor.js'
import { embedBatchLocal } from './embed-runtime.js'
import { generateOllamaText } from './ollama.js'
import { resolveConfig } from './presets.js'

// Embedder backed by the local nomic-embed runtime. Falls back to a zero vector for any chunk that fails to
// embed (keeps tree shape stable; that node simply won't be retrieved).
const liveEmbed: Embedder = async (texts) => {
  const out = await embedBatchLocal(texts)
  if (!out) return texts.map(() => [])
  return out.map((v) => v ?? [])
}

// Summarizer backed by the preset model: condense a cluster of passages into one abstractive summary node.
const liveSummarize: Summarizer = async (texts) => {
  const model = resolveConfig().model
  const joined = texts.map((t, i) => `[${i + 1}] ${t}`).join('\n\n').slice(0, 6000)
  const { content } = await generateOllamaText({
    model,
    temperature: 0.2,
    messages: [{
      role: 'user',
      content: `Write a single concise, self-contained summary that captures the key facts and themes across ` +
        `these related passages. Preserve specific entities and claims; do not add information not present.\n\n${joined}\n\nSummary:`,
    }],
  })
  return content.trim()
}

const CACHE = new Map<string, RaptorTree>()

/** Build (or fetch cached) a RAPTOR tree for a corpus. `key` identifies the corpus (e.g., a domain/workspace id). */
export async function buildRaptorIndex(key: string, chunks: string[], rebuild = false): Promise<RaptorTree> {
  if (!rebuild && CACHE.has(key)) return CACHE.get(key)!
  const tree = await buildRaptorTree(chunks, liveEmbed, liveSummarize)
  CACHE.set(key, tree)
  return tree
}

/** Retrieve from the collapsed RAPTOR tree for a (typically summarize-intent) query. */
export async function raptorRetrieve(tree: RaptorTree, query: string, k = 8): Promise<RaptorNode[]> {
  const q = (await liveEmbed([query]))[0] ?? []
  if (!q.length) return []
  return collapsedRetrieve(tree, q, k)
}
