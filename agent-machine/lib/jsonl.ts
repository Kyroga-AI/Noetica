/**
 * jsonl — the shared line-delimited-JSON reader.
 *
 * Three call sites (solution-memory, qa-pairs, dispatch-ledger) repeated the same
 * `readFileSync → trim → split('\n') → filter(Boolean) → map(JSON.parse)` with a `catch → []`.
 * A missing file throws ENOENT → caught → `[]` (so no separate existsSync check is needed). `limit`
 * tail-slices to the most-recent N lines (the append-only-log access pattern those callers use).
 */
import * as fs from 'node:fs'

export function readJsonl<T>(file: string, opts: { limit?: number } = {}): T[] {
  let lines: string[]
  try {
    // Separate the READ from the PARSE: a missing file → [] here; a single corrupt/truncated line must
    // NOT zero the whole ledger (the old `sliced.map(JSON.parse)` threw on one bad line → catch → []).
    lines = fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean)
  } catch {
    return []
  }
  const sliced = opts.limit != null ? lines.slice(-opts.limit) : lines
  const out: T[] = []
  let skipped = 0
  for (const l of sliced) {
    try { out.push(JSON.parse(l) as T) } catch { skipped++ }
  }
  if (skipped > 0) console.warn(`[jsonl] skipped ${skipped} unparseable line(s) in ${file} (kept ${out.length})`)
  return out
}
