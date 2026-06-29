/**
 * synapseiq-enrich.ts — structural / language-intelligence enrichment for onboarded assets, via SynapseIQ
 * (SocioProphet/synapseiq: Tree-sitter grammars + LSP). The curation step that turns a raw asset into typed
 * SYMBOLS + ENTITIES ready for knowledge-graph linkage (feeds auto-KG).
 *
 * Service-agnostic + fail-open: the SynapseIQ call is an INJECTABLE transport (the HTTP bridge to
 * SOURCEOS_SYNAPSEIQ_URL in prod, a stub in tests). When SynapseIQ is unavailable, a DETERMINISTIC offline
 * fallback extracts symbols (code definitions + markdown headings) so onboarding never blocks — same discipline
 * as redact / characterization. Pure aside from the optional transport.
 */

import type { KgTriple } from './auto-kg.js'

export interface SynapseSymbol { name: string; kind: string; line?: number }
export interface SynapseEnrichment {
  lang: string | null
  symbols: SynapseSymbol[]
  entities: string[]                     // deduped symbol names — the linkable handles
  kinds: Record<string, number>          // symbol-kind histogram
  source: 'synapseiq' | 'fallback'
}

/** The SynapseIQ transport: send content, get language + symbols. Returns null on unavailable/empty. */
export type SynapseTransport = (content: string, opts: { filename?: string }) => Promise<{ lang?: string; symbols?: SynapseSymbol[] } | null>

const EXT_LANG: Record<string, string> = {
  py: 'python', ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
  rs: 'rust', go: 'go', java: 'java', rb: 'ruby', c: 'c', cpp: 'cpp', h: 'c', md: 'markdown', sql: 'sql',
}
const langOf = (filename?: string): string | null => {
  const ext = filename?.split('.').pop()?.toLowerCase()
  return ext ? EXT_LANG[ext] ?? null : null
}

// Deterministic offline extraction: code definitions across common langs + markdown headings.
const DEF_RES: Array<{ re: RegExp; kind: string }> = [
  { re: /^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm, kind: 'function' },
  { re: /^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)/gm, kind: 'function' },
  { re: /^\s*(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z_]\w*)/gm, kind: 'function' },
  { re: /^\s*(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/gm, kind: 'class' },
  { re: /^\s*(?:export\s+)?(?:interface|type)\s+([A-Za-z_$][\w$]*)/gm, kind: 'type' },
  { re: /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/gm, kind: 'binding' },
  { re: /^#{1,6}\s+(.+?)\s*$/gm, kind: 'heading' },
]

export function fallbackSymbols(content: string, filename?: string): { lang: string | null; symbols: SynapseSymbol[] } {
  const lang = langOf(filename)
  const symbols: SynapseSymbol[] = []
  const seen = new Set<string>()
  outer: for (const { re, kind } of DEF_RES) {
    if (kind === 'heading' && lang !== 'markdown') continue
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(content))) {
      const name = (m[1] ?? '').trim()
      if (!name || name.length > 80) continue
      const key = `${kind}:${name}`
      if (seen.has(key)) continue
      seen.add(key)
      symbols.push({ name, kind })
      if (symbols.length >= 200) break outer
    }
  }
  return { lang, symbols }
}

/** Enrich an asset's content into symbols + entities. Tries SynapseIQ; falls back deterministically. Never throws. */
export async function synapseEnrich(content: string, opts: { filename?: string } = {}, transport?: SynapseTransport): Promise<SynapseEnrichment> {
  let lang: string | null = langOf(opts.filename)
  let symbols: SynapseSymbol[] = []
  let source: SynapseEnrichment['source'] = 'fallback'
  if (transport && content) {
    try {
      const r = await transport(content, opts)
      if (r && Array.isArray(r.symbols) && r.symbols.length) { symbols = r.symbols; lang = r.lang ?? lang; source = 'synapseiq' }
    } catch { /* fall through to deterministic fallback */ }
  }
  if (symbols.length === 0) { const fb = fallbackSymbols(content, opts.filename); symbols = fb.symbols; lang = fb.lang }
  const entities = [...new Set(symbols.map((s) => s.name))]
  const kinds: Record<string, number> = {}
  for (const s of symbols) kinds[s.kind] = (kinds[s.kind] ?? 0) + 1
  return { lang, symbols, entities, kinds, source }
}

/**
 * Bridge the enrichment to KG triples for auto-KG linkage: the asset CONTAINS each symbol, and each symbol IS_A
 * its kind. These become PENDING graph proposals (via auto-KG triplesToProposals) — governed, never canonical.
 */
export function enrichmentToTriples(assetId: string, e: SynapseEnrichment): KgTriple[] {
  const out: KgTriple[] = []
  for (const s of e.symbols) {
    out.push({ subject: assetId, predicate: 'contains', object: s.name })
    out.push({ subject: s.name, predicate: 'is_a', object: s.kind })
  }
  return out
}

/** Default HTTP transport to the SynapseIQ service (SOURCEOS_SYNAPSEIQ_URL). Returns null on any failure. */
export function defaultSynapseTransport(baseUrl = process.env['SOURCEOS_SYNAPSEIQ_URL']): SynapseTransport {
  return async (content, opts) => {
    if (!baseUrl) return null
    try {
      const r = await fetch(`${baseUrl.replace(/\/$/, '')}/symbols`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content, filename: opts.filename }), signal: AbortSignal.timeout(8000),
      })
      if (!r.ok) return null
      return (await r.json()) as { lang?: string; symbols?: SynapseSymbol[] }
    } catch { return null }
  }
}
