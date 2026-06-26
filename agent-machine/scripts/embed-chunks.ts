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
import { embedBatch, EMBED_MODEL } from '../lib/ollama.js'
import { encodeVec } from '../lib/brain-vec.js'

const IN = process.argv[2]
const BRAIN = process.argv[3]
const BATCH = Number(process.env['EMBED_BATCH'] || 64)

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
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH)
      const vecs = await embedBatch(batch.map((r) => r.text)).catch(() => batch.map(() => [] as number[]))
      for (let j = 0; j < batch.length; j++) {
        const v = vecs[j]
        if (!v || !v.length) continue
        out.write(JSON.stringify({ text: batch[j]!.text, slug: batch[j]!.slug, field,
          material: batch[j]!.material, vec: encodeVec(v), dims: 768 }) + '\n')
        written++
      }
    }
    await new Promise<void>((r) => out.end(r))
    grand += written
    console.log(`  ${field}: ${rows.length} chunks → ${written} vectors`)
  }
  console.log(`# DONE — ${grand} vectors → ${BRAIN}/<field>/<field>.jsonl`)
}
main().catch((e) => { console.error(e); process.exit(1) })
