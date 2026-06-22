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
  const m = s.match(/^magnet:\?(.+)$/)
  if (!m) return null
  const params = new URLSearchParams(m[1]!)
  const xt = params.get('xt') ?? ''
  const hash = xt.match(/urn:sha256:([a-f0-9]+)/i)?.[1]
  if (!hash) return null
  return { hash, title: params.get('dn') ? decodeURIComponent(params.get('dn')!) : undefined, size: params.get('xl') ? Number(params.get('xl')) : undefined, type: params.get('x.type') ?? undefined }
}

export interface SwarmEntry {
  hash: string; title: string; type: string; size: number
  providers: Set<string>; reuseCount: number; firstSeen: number; lastSeen: number; tags: string[]
}

export interface SwarmResult { hash: string; title: string; type: string; magnet: string; seeders: number; reuse: number; health: number; relevance?: number }

const tokens = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1)

export class ArtifactSwarm {
  private index = new Map<string, SwarmEntry>()
  constructor(private now: () => number = () => Date.now()) {}

  /** A provider announces it holds an asset (seeder). Identical content (same hash) merges into one entry. */
  announce(opts: { hash: string; title: string; type?: string; size?: number; provider: string; tags?: string[] }): SwarmEntry {
    const t = this.now()
    let e = this.index.get(opts.hash)
    if (!e) {
      e = { hash: opts.hash, title: opts.title, type: opts.type ?? 'document', size: opts.size ?? 0, providers: new Set(), reuseCount: 0, firstSeen: t, lastSeen: t, tags: opts.tags ?? [] }
      this.index.set(opts.hash, e)
    }
    e.providers.add(opts.provider); e.lastSeen = t
    if (opts.tags) e.tags = [...new Set([...e.tags, ...opts.tags])]
    return e
  }

  /** Record a reuse of an asset (referenced/embedded/forked elsewhere) — the popularity signal. */
  recordReuse(hash: string): void { const e = this.index.get(hash); if (e) { e.reuseCount++; e.lastSeen = this.now() } }

  providers(hash: string): string[] { return [...(this.index.get(hash)?.providers ?? [])] }

  /** Swarm health 0..1: availability (seeders) + popularity (reuse) + recency — torrent-health analog. */
  health(hash: string): number {
    const e = this.index.get(hash); if (!e) return 0
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
export function getSwarm(): ArtifactSwarm { return (_swarm ??= new ArtifactSwarm()) }
export const LOCAL_PROVIDER = 'noetica-local'
