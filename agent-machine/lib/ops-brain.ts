/**
 * ops-brain — retrieval over the OPERATIONS corpus (runbooks / manpages).
 *
 * A SEPARATE store from the academic (OCW) brain and the chat (atomspace) brain — see brain-scope.ts.
 * This corpus was being WRITTEN (scripts/capture_manpages.py → ~/.noetica/ops-corpus/manpages.jsonl)
 * but never READ — operational knowledge was unwired. It is raw text chunks with NO vectors, so
 * retrieval here is LEXICAL: stemmed, stopword-free term overlap (the same primitive the brain rerank
 * uses), which is fast and dependency-free. Keeping ops in its own store means chat can never pollute
 * it and vice-versa.
 */
import * as fs from 'node:fs'
import { termSet } from './text-normalize.js'
import { BrainScope } from './brain-scope.js'
import { opsBrainFile } from './brain-home.js'

// Resolved lazily (not at module load) so env changes — and tests — take effect.
const opsCorpusPath = opsBrainFile
const MAX = Number(process.env['OPS_BRAIN_CAP'] || 80000)

interface OpsChunk { text: string; subject: string; section: string; domain: string; terms: Set<string> }
let _cache: OpsChunk[] | null = null

function load(): OpsChunk[] {
  if (_cache) return _cache
  const out: OpsChunk[] = []
  try {
    for (const line of fs.readFileSync(opsCorpusPath(), 'utf8').split('\n')) {
      if (!line.trim() || out.length >= MAX) continue
      try {
        const o = JSON.parse(line) as { text?: string; subject?: string; man_section?: string; domain?: string }
        if (!o.text) continue
        out.push({ text: o.text, subject: o.subject || '', section: o.man_section || '', domain: o.domain || '', terms: termSet(o.text) })
      } catch { /* skip malformed line */ }
    }
  } catch { /* no corpus on this machine → empty (lane is a no-op) */ }
  _cache = out
  return out
}

export interface OpsHit { text: string; subject: string; section: string; score: number; scope: string }

/** Whether the operations corpus is present (so the retrieval lane can no-op cleanly when absent). */
export function opsBrainReady(): boolean {
  try { const p = opsCorpusPath(); return fs.existsSync(p) && fs.statSync(p).size > 0 } catch { return false }
}

/** Lexical (stemmed term-overlap) retrieval over the ops corpus. Top-k operational chunks for a query. */
export function opsBrainRetrieve(query: string, k = 6): OpsHit[] {
  const q = termSet(query)
  if (q.size === 0) return []
  const scored: OpsHit[] = []
  for (const c of load()) {
    let hit = 0
    for (const w of q) if (c.terms.has(w)) hit++
    if (hit === 0) continue
    // coverage of the query terms, with a small boost when the chunk's subject (the command/topic name)
    // is itself one of the query terms — "how do I use grep" should favour the grep manpage.
    const subjectBoost = c.subject && q.has(c.subject.toLowerCase()) ? 0.25 : 0
    scored.push({ text: c.text, subject: c.subject, section: c.section, score: hit / q.size + subjectBoost, scope: BrainScope.Operational })
  }
  scored.sort((a, b) => b.score - a.score)
  // dedup near-identical chunks by text prefix
  const seen = new Set<string>()
  const out: OpsHit[] = []
  for (const h of scored) {
    const key = h.text.slice(0, 80)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(h)
    if (out.length >= k) break
  }
  return out
}

// test seam
export function _resetOpsBrainCache(): void { _cache = null }

// CLI self-test:  OPS_CORPUS=… npx tsx lib/ops-brain.ts "how do I list open files"
if (process.argv[1] && process.argv[1].endsWith('ops-brain.ts')) {
  const q = process.argv[2] || 'how do I find a process by name'
  console.log(`# ops-brain · ready=${opsBrainReady()} · query="${q}"\n`)
  for (const h of opsBrainRetrieve(q, 5)) console.log(`  [${h.score.toFixed(3)} ${h.subject}(${h.section})] ${h.text.slice(0, 100).replace(/\s+/g, ' ')}…`)
}
