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
  try {
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean)
    const sliced = opts.limit != null ? lines.slice(-opts.limit) : lines
    return sliced.map((l) => JSON.parse(l) as T)
  } catch {
    return []
  }
}
