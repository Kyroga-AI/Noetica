/**
 * symbol-index — load the build-time symbol manifest (canon/symbol-index.json) and search it by name, so the
 * coding agent can jump to a definition (file + line) instead of grepping blind. Complements stack-graph (module
 * level) with definition-site detail. Bundled into the binary at build time (the binary has no source at runtime).
 */
import symbolIndex from '../canon/symbol-index.json'

export interface CodeSymbol { name: string; kind: string; rel: string; line: number; lang: string }

const ALL: CodeSymbol[] = (symbolIndex as { symbols?: CodeSymbol[] }).symbols ?? []

/** Rank: exact name match > prefix > substring. Case-insensitive. */
export function searchSymbols(query: string, limit = 25): CodeSymbol[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const exact: CodeSymbol[] = [], prefix: CodeSymbol[] = [], sub: CodeSymbol[] = []
  for (const s of ALL) {
    const n = s.name.toLowerCase()
    if (n === q) exact.push(s)
    else if (n.startsWith(q)) prefix.push(s)
    else if (n.includes(q)) sub.push(s)
  }
  return [...exact, ...prefix, ...sub].slice(0, limit)
}

export function symbolStats(): { count: number } {
  return { count: ALL.length }
}
