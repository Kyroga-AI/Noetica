/**
 * search-broker.ts — Data → Search: local vs platform, consuming the canonical search services.
 *   local    = SocioProphet/lampstand (desktop file index) — unix-socket JSON-line `Search{query,limit,snippet}`.
 *   platform = SocioProphet/sherlock-search — HTTP, returns the evidence-answer contract (evidence[] w/ score+snippet).
 * We CONSUME them (conform to their shapes); we don't reimplement search. Each source is queried independently,
 * so one being down/unconfigured never fails the other. Config via env: LAMPSTAND_SOCKET, SHERLOCK_URL.
 */
import net from 'node:net'

export type SearchScope = 'local' | 'platform' | 'all'
export interface SearchHit { source: 'local' | 'platform'; title: string; ref: string; snippet: string; score: number }
export interface SourceResult { ok: boolean; configured: boolean; hits: SearchHit[]; error?: string }
export interface SearchResult { query: string; local: SourceResult; platform: SourceResult }

export type Fetchish = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>

const lampstandSocket = () => process.env.LAMPSTAND_SOCKET || ''
const sherlockUrl = () => process.env.SHERLOCK_URL || ''

/**
 * Local search. When the external lampstand desktop index is configured (LAMPSTAND_SOCKET) we consume it;
 * otherwise — the normal sovereign install — we search Noetica's OWN on-device knowledge (the ingested
 * docs + memory in HellGraph). So "Local" search works out of the box against your own data instead of
 * reporting "not configured" and returning nothing.
 */
export function searchLocal(query: string, socketPath = lampstandSocket(), limit = 20): Promise<SourceResult> {
  if (!socketPath) return searchOnDevice(query, limit)
  return searchLampstand(query, socketPath, limit)
}

/** Search the on-device doc/memory store (BM25 lexical, always available; fused with semantic when the
 *  embedder is up). No external service, no config — this is the default sovereign search. */
async function searchOnDevice(query: string, limit: number): Promise<SourceResult> {
  if (!query.trim()) return { ok: true, configured: true, hits: [] }
  try {
    const { lexicalSearch, semanticSearch } = await import('./doc-store.js')
    type Chunk = { text: string; filename: string; score: number; docId: string; idx?: number }
    const lex: Chunk[] = lexicalSearch(query, limit)
    let sem: Chunk[] = []
    try { sem = await semanticSearch(query, Math.min(limit, 8)) } catch { /* embedder down → lexical only */ }
    const byKey = new Map<string, Chunk>()
    for (const c of [...lex, ...sem]) {
      const key = `${c.docId}#${c.idx ?? 0}`
      const prev = byKey.get(key)
      if (!prev || c.score > prev.score) byKey.set(key, c)
    }
    const hits: SearchHit[] = [...byKey.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((c) => ({
        source: 'local',
        title: c.filename || 'document',
        ref: c.idx != null ? `${c.filename}#${c.idx}` : (c.docId || c.filename),
        snippet: c.text.replace(/\s+/g, ' ').trim().slice(0, 240),
        score: c.score,
      }))
    return { ok: true, configured: true, hits }
  } catch (e) {
    return { ok: false, configured: true, hits: [], error: e instanceof Error ? e.message : 'on-device search failed' }
  }
}

/** lampstand: send one JSON-line request over its unix socket and read one JSON-line response. */
function searchLampstand(query: string, socketPath: string, limit: number): Promise<SourceResult> {
  return new Promise((resolve) => {
    const sock = net.createConnection(socketPath)
    let buf = ''
    let settled = false
    const fin = (r: SourceResult) => { if (!settled) { settled = true; sock.destroy(); resolve(r) } }
    const timer = setTimeout(() => fin({ ok: false, configured: true, hits: [], error: 'timeout' }), 6000)
    sock.on('connect', () => sock.write(JSON.stringify({ method: 'Search', params: { query, limit, snippet: true } }) + '\n'))
    sock.on('data', (d: Buffer) => {
      buf += d.toString()
      const nl = buf.indexOf('\n'); if (nl < 0) return
      clearTimeout(timer)
      try {
        const resp = JSON.parse(buf.slice(0, nl)) as Record<string, unknown>
        const raw = (resp.result ?? resp) as Record<string, unknown>
        const items = (raw.hits ?? raw.items ?? raw.matches ?? []) as Array<Record<string, unknown>>
        const hits: SearchHit[] = items.map((h) => ({
          source: 'local',
          title: String(h.name ?? h.path ?? h.title ?? ''),
          ref: String(h.path ?? h.uri ?? h.ref ?? ''),
          snippet: String(h.snippet ?? h.summary ?? ''),
          score: typeof h.score === 'number' ? h.score : 0,
        }))
        fin({ ok: true, configured: true, hits })
      } catch (e) { fin({ ok: false, configured: true, hits: [], error: e instanceof Error ? e.message : 'decode' }) }
    })
    sock.on('error', (e) => { clearTimeout(timer); fin({ ok: false, configured: true, hits: [], error: e.message }) })
  })
}

/** sherlock: HTTP query returning the evidence-answer contract; map evidence[] → hits. */
export async function searchPlatform(query: string, url = sherlockUrl(), fetchImpl: Fetchish = fetch as unknown as Fetchish): Promise<SourceResult> {
  if (!url) return { ok: false, configured: false, hits: [] }
  try {
    const res = await fetchImpl(`${url.replace(/\/$/, '')}/search`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query }) })
    if (!res.ok) return { ok: false, configured: true, hits: [], error: `sherlock ${res.status}` }
    const data = (await res.json()) as { anchors?: Array<Record<string, unknown>>; evidence?: Array<Record<string, unknown>> }
    const anchorRef = (id: unknown) => {
      const a = (data.anchors ?? []).find((x) => x.anchorId === id)
      return a ? String(a.sourceRef ?? (a.locators as { heading?: string } | undefined)?.heading ?? a.anchorId) : String(id ?? '')
    }
    const hits: SearchHit[] = (data.evidence ?? []).map((e) => ({
      source: 'platform',
      title: anchorRef((e.anchorRefs as unknown[])?.[0]),
      ref: String((e.anchorRefs as unknown[])?.[0] ?? e.evidenceId ?? ''),
      snippet: String(e.snippet ?? ''),
      score: typeof e.score === 'number' ? e.score : 0,
    }))
    return { ok: true, configured: true, hits }
  } catch (e) {
    return { ok: false, configured: true, hits: [], error: e instanceof Error ? e.message : 'sherlock unreachable' }
  }
}

export async function search(query: string, scope: SearchScope = 'all', opts: { localSocket?: string; platformUrl?: string; fetchImpl?: Fetchish } = {}): Promise<SearchResult> {
  const doLocal = scope === 'local' || scope === 'all'
  const doPlatform = scope === 'platform' || scope === 'all'
  const [local, platform] = await Promise.all([
    doLocal ? searchLocal(query, opts.localSocket) : Promise.resolve<SourceResult>({ ok: false, configured: false, hits: [] }),
    doPlatform ? searchPlatform(query, opts.platformUrl, opts.fetchImpl) : Promise.resolve<SourceResult>({ ok: false, configured: false, hits: [] }),
  ])
  return { query, local, platform }
}
