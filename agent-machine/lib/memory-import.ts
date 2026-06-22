/**
 * memory-import.ts — cross-vendor memory portability (OpenAI/Google/Anthropic all shipped import Mar 2026).
 * Parse a distilled memory-export text block from another assistant into individual, source-tagged memories
 * our store can absorb. A memory silo you can't import into is a switching cost AGAINST us.
 */
export interface ImportedMemory { text: string; source: string; index: number }

/** Split an exported memory block (bulleted / numbered / one-per-line) into clean individual memories. */
export function parseMemoryExport(text: string, source: string): ImportedMemory[] {
  const lines = text.split(/\r?\n+/)
    .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim())   // strip bullets / numbering
    .filter((l) => l.length >= 4 && !/^#{1,6}\s/.test(l))           // drop headers + noise
  const seen = new Set<string>()
  const out: ImportedMemory[] = []
  for (const l of lines) {
    const key = l.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ text: l, source, index: out.length })
  }
  return out
}
