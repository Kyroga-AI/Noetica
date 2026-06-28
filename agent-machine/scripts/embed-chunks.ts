/**
 * embed-chunks — Stage 2 of the clean brain build: embed the clean chunk jsonl (from chunk-corpus.py) into the
 * board's brain format, using the SAME embedder the board queries with (embedBatch / nomic-embed-text @ 768-d).
 * Reusing embedBatch (not reimplementing) makes query↔document compatibility true by construction — a prefix or
 * dims drift here would silently desync the brain. Reads <in>/<field>.jsonl ({text,slug,field,material}),
 * writes <brain>/<field>/<field>.jsonl ({text,slug,field,material,vec:base64,dims:768}) — the layout
 * study-brain.ts loads (one subdir per field).
 *
 *   EMBED_BATCH=64 npx tsx scripts/embed-chunks.ts <clean_chunks_dir> <brain_out_dir>
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { EMBED_MODEL } from '../lib/ollama.js'
import { encodeVec } from '../lib/brain-vec.js'

const IN = process.argv[2]
const BRAIN = process.argv[3]
const BATCH = Number(process.env['EMBED_BATCH'] || 64)
// ollama is OVERHEAD-bound, not GPU-bound — concurrency to ONE instance doesn't help (it serializes). So we fan
// batches out across MULTIPLE ollama instances (OLLAMA_HOSTS), each on its own port → ~N× throughput. One worker
// per host×slot; each worker hits a fixed host. Request is byte-identical to lib/ollama.embedBatch (no prefix).
const HOSTS = (process.env['OLLAMA_HOSTS'] || process.env['OLLAMA_HOST'] || 'http://127.0.0.1:11434')
  .split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean)
const CONC = Number(process.env['BRAIN_CONCURRENCY'] || HOSTS.length * 2)

async function embedOn(host: string, texts: string[]): Promise<number[][]> {
  try {
    const res = await fetch(`${host}/api/embed`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: EMBED_MODEL, input: texts.map((t) => t.slice(0, 8000)) }),
      signal: AbortSignal.timeout(120_000),
    })
    if (!res.ok) return texts.map(() => [])
    const j = (await res.json()) as { embeddings?: number[][] }
    return Array.isArray(j.embeddings) && j.embeddings.length === texts.length ? j.embeddings : texts.map(() => [])
  } catch { return texts.map(() => []) }
}

async function main(): Promise<void> {
  if (!IN || !BRAIN) { console.error('usage: embed-chunks.ts <clean_chunks_dir> <brain_out_dir>'); process.exit(1) }
  const files = fs.readdirSync(IN).filter((f) => f.endsWith('.jsonl'))
  console.log(`# embed-chunks — ${files.length} fields, model=${EMBED_MODEL}, batch=${BATCH}`)
  let grand = 0
  for (const f of files) {
    const field = f.replace(/\.jsonl$/, '')
    const rows = fs.readFileSync(path.join(IN, f), 'utf8').split('\n').filter(Boolean)
      .map((l) => JSON.parse(l) as { text: string; slug: string; material: string })
    const outDir = path.join(BRAIN, field)
    fs.mkdirSync(outDir, { recursive: true })
    const out = fs.createWriteStream(path.join(outDir, `${field}.jsonl`))
    let written = 0
    const starts: number[] = []
    for (let i = 0; i < rows.length; i += BATCH) starts.push(i)
    let next = 0
    // CONC workers pull batches off a shared cursor; worker w is pinned to HOSTS[w % nHosts] → the N ollama
    // instances run in parallel (the real speedup, since one instance serializes regardless of concurrency).
    await Promise.all(Array.from({ length: Math.min(CONC, starts.length) }, async (_v, w) => {
      const host = HOSTS[w % HOSTS.length]!
      while (next < starts.length) {
        const i = starts[next++]!
        const batch = rows.slice(i, i + BATCH)
        const vecs = await embedOn(host, batch.map((r) => r.text))
        for (let j = 0; j < batch.length; j++) {
          const v = vecs[j]
          if (!v || !v.length) continue
          out.write(JSON.stringify({ text: batch[j]!.text, slug: batch[j]!.slug, field,
            material: batch[j]!.material, vec: encodeVec(v), dims: 768 }) + '\n')
          written++
        }
      }
    }))
    await new Promise<void>((r) => out.end(r))
    grand += written
    console.log(`  ${field}: ${rows.length} chunks → ${written} vectors`)
  }
  console.log(`# DONE — ${grand} vectors → ${BRAIN}/<field>/<field>.jsonl`)
}
main().catch((e) => { console.error(e); process.exit(1) })
