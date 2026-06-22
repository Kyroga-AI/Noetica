/**
 * artifact-swarm.ts — "BitTorrent for artifacts": content-addressed search / discovery / reuse / ranking.
 * BitTorrent primitives map directly onto our artifacts:
 *   • info-hash      → the sha256 content hash (our CMS/blob-store already content-addresses → identical
 *                      content is ONE asset, automatically deduped + reused)
 *   • magnet link    → a portable `magnet:?xt=urn:sha256:…` reference to fetch/discover an asset
 *   • seeders        → providers (which nodes/CMS have the blob) = AVAILABILITY
 *   • swarm health   → ranking signal: well-seeded + frequently-reused + recent = healthy/trusted
 *   • DHT            → the swarm index (hash → providers + metadata); federates over storage-node-routes
 * So discovery ranks by relevance × swarm-health, and the most-REUSED assets surface to the top.
 */
export interface MagnetRef { hash: string; title?: string; type?: string; size?: number }

/** A portable content-addressed reference, BitTorrent magnet syntax (xt/dn/xl + our type). */
export function toMagnet(ref: MagnetRef): string {
  const p = [`xt=urn:sha256:${ref.hash}`]
  if (ref.title) p.push(`dn=${encodeURIComponent(ref.title)}`)
  if (ref.size != null) p.push(`xl=${ref.size}`)
  if (ref.type) p.push(`x.type=${ref.type}`)
  return `magnet:?${p.join('&')}`
}

export function parseMagnet(s: string): MagnetRef | null {
  if (typeof s !== 'string' || s.length > 4096) return null
  const m = /^magnet:\?(.+)$/.exec(s)
  if (!m) return null
  const params = new URLSearchParams(m[1]!)
  const hash = /urn:sha256:([a-f0-9]{4,128})/i.exec(params.get('xt') ?? '')?.[1]?.toLowerCase()
  if (!hash) return null
  const size = params.get('xl') ? Number(params.get('xl')) : undefined
  return { hash, title: params.get('dn') ? decodeURIComponent(params.get('dn')!) : undefined, size: Number.isFinite(size) ? size : undefined, type: params.get('x.type') ?? undefined }
}

export interface SwarmEntry {
  hash: string; title: string; type: string; size: number
  providers: Set<string>; reuseCount: number; firstSeen: number; lastSeen: number; tags: string[]
}

export interface SwarmResult { hash: string; title: string; type: string; magnet: string; seeders: number; reuse: number; health: number; relevance?: number }
export interface SwarmSnapshot { hash: string; title: string; type: string; size: number; providers: string[]; reuseCount: number; firstSeen: number; lastSeen: number; tags: string[] }

const MAX_ENTRIES = 50_000          // OOM backstop for an untrusted announce surface
const MAX_TAGS = 32
const tokens = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1)
/** A content hash is acceptable iff it's a bounded hex/alphanumeric token (rejects "undefined", giant blobs). */
export const isValidHash = (h: string): boolean => typeof h === 'string' && /^[a-z0-9]{4,128}$/i.test(h)
const normHash = (h: string) => h.trim().toLowerCase()

export class ArtifactSwarm {
  private index = new Map<string, SwarmEntry>()
  constructor(private now: () => number = () => Date.now()) {}

  /** A provider announces it holds an asset (seeder). Identical content (same hash) merges into one entry.
   * Hash is normalized + validated; the index is LRU-capped so an untrusted announce flood can't OOM. */
  announce(opts: { hash: string; title: string; type?: string; size?: number; provider: string; tags?: string[] }): SwarmEntry {
    const hash = normHash(opts.hash)
    if (!isValidHash(hash)) throw new Error('invalid_hash')
    const t = this.now()
    let e = this.index.get(hash)
    if (!e) {
      this.evictIfFull(hash)
      e = { hash, title: String(opts.title).slice(0, 300), type: opts.type ?? 'document', size: Math.max(0, opts.size ?? 0), providers: new Set(), reuseCount: 0, firstSeen: t, lastSeen: t, tags: (opts.tags ?? []).slice(0, MAX_TAGS) }
      this.index.set(hash, e)
    }
    e.providers.add(String(opts.provider).slice(0, 200)); e.lastSeen = t
    if (opts.tags) e.tags = [...new Set([...e.tags, ...opts.tags])].slice(0, MAX_TAGS)
    return e
  }

  private evictIfFull(incoming: string): void {
    if (this.index.size < MAX_ENTRIES) return
    let oldest: string | undefined; let oldestT = Infinity
    for (const [h, e] of this.index) if (h !== incoming && e.lastSeen < oldestT) { oldestT = e.lastSeen; oldest = h }
    if (oldest) this.index.delete(oldest)
  }

  /** Persist/restore the swarm index (providers Set ⇄ array) — survives restart. */
  snapshot(): SwarmSnapshot[] { return [...this.index.values()].map((e) => ({ ...e, providers: [...e.providers] })) }
  hydrate(snaps: unknown): void {
    if (!Array.isArray(snaps)) return
    for (const raw of snaps) {
      const s = raw as SwarmSnapshot
      if (!s || !isValidHash(String(s.hash)) || !Array.isArray(s.providers)) continue
      this.index.set(normHash(s.hash), { hash: normHash(s.hash), title: s.title ?? '', type: s.type ?? 'document', size: s.size ?? 0, providers: new Set(s.providers), reuseCount: s.reuseCount ?? 0, firstSeen: s.firstSeen ?? 0, lastSeen: s.lastSeen ?? 0, tags: Array.isArray(s.tags) ? s.tags : [] })
    }
  }

  /** Record a reuse of an asset (referenced/embedded/forked elsewhere) — the popularity signal. */
  recordReuse(hash: string): void { const e = this.index.get(normHash(hash)); if (e) { e.reuseCount++; e.lastSeen = this.now() } }

  providers(hash: string): string[] { return [...(this.index.get(normHash(hash))?.providers ?? [])] }

  /** Swarm health 0..1: availability (seeders) + popularity (reuse) + recency — torrent-health analog. */
  health(hash: string): number {
    const e = this.index.get(normHash(hash)); if (!e) return 0
    const seeders = e.providers.size
    const days = (this.now() - e.lastSeen) / 86_400_000
    const recency = Math.pow(0.5, days / 30)                    // 30-day half-life
    const avail = 1 - 1 / (1 + seeders)                          // 0 → 0, saturating toward 1
    const pop = 1 - 1 / (1 + e.reuseCount)
    return Number((0.4 * avail + 0.4 * pop + 0.2 * recency).toFixed(4))
  }

  private toResult(e: SwarmEntry, relevance?: number): SwarmResult {
    return { hash: e.hash, title: e.title, type: e.type, magnet: toMagnet({ hash: e.hash, title: e.title, type: e.type, size: e.size }), seeders: e.providers.size, reuse: e.reuseCount, health: this.health(e.hash), ...(relevance != null ? { relevance } : {}) }
  }

  /** Discovery: rank by relevance(query) × swarm-health. Empty query → ranked purely by health. */
  search(query: string, opts: { topK?: number; type?: string } = {}): SwarmResult[] {
    const qt = tokens(query)
    const scored = [...this.index.values()]
      .filter((e) => !opts.type || e.type === opts.type)
      .map((e) => {
        const hay = (e.title + ' ' + e.tags.join(' ')).toLowerCase()
        const rel = qt.length === 0 ? 1 : qt.filter((t) => hay.includes(t)).length / qt.length
        return { e, rel, score: rel * (0.5 + this.health(e.hash)) }
      })
      .filter((x) => x.rel > 0)
      .sort((a, b) => b.score - a.score)
    return scored.slice(0, opts.topK ?? 20).map((x) => this.toResult(x.e, Number(x.rel.toFixed(3))))
  }

  /** Most-reused (popular) assets — the "trending"/canonical-reuse leaderboard. */
  topByReuse(k = 10): SwarmResult[] {
    return [...this.index.values()].sort((a, b) => b.reuseCount - a.reuseCount).slice(0, k).map((e) => this.toResult(e))
  }

  /** Low-availability assets (few seeders) — at risk, need replication. */
  rare(k = 10): SwarmResult[] {
    return [...this.index.values()].filter((e) => e.providers.size <= 1).sort((a, b) => a.providers.size - b.providers.size).slice(0, k).map((e) => this.toResult(e))
  }

  size(): number { return this.index.size }
}

// Process-level swarm singleton (the local DHT node; federates over storage-node-routes later).
let _swarm: ArtifactSwarm | null = null
export const LOCAL_PROVIDER = 'noetica-local'
const swarmIndexPath = async () => { const os = await import('node:os'); const path = await import('node:path'); return path.join(os.homedir(), '.noetica', 'swarm', 'index.json') }

export function getSwarm(): ArtifactSwarm {
  if (_swarm) return _swarm
  _swarm = new ArtifactSwarm()
  // best-effort restore (sync, on first use) so search works immediately after restart
  void (async () => {
    try { const { existsSync, readFileSync } = await import('node:fs'); const idx = await swarmIndexPath(); if (existsSync(idx)) _swarm!.hydrate(JSON.parse(readFileSync(idx, 'utf8'))) } catch { /* fresh */ }
  })()
  return _swarm
}

export async function persistSwarm(): Promise<void> {
  if (!_swarm) return
  const { writeFileSync, mkdirSync, renameSync } = await import('node:fs')
  const path = await import('node:path')
  try { const idx = await swarmIndexPath(); mkdirSync(path.dirname(idx), { recursive: true }); const tmp = `${idx}.tmp`; writeFileSync(tmp, JSON.stringify(_swarm.snapshot())); renameSync(tmp, idx) } catch { /* ignore */ }
}
