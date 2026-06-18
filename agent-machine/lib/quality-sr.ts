/**
 * Quality symbolic-regression — discover what drives answer quality.
 *
 * The Prometheus/SINDy loop already learns the graph's attention-decay law. This
 * applies the same "discover the governing relationship from data" idea to answer
 * quality: it records a sample per chat run (Value-Judgment worth + the features
 * that might explain it) and fits the drivers — which signal most predicts worth.
 * Output can then tune retrieval/routing (e.g. if graph-grounding dominates worth,
 * widen retrieval; if latency anti-correlates, prefer faster models).
 *
 * Deterministic least-squares / Pearson — unit-tested. (Full multivariate SINDy
 * over this corpus is the heavier future step; this is the load-bearing first cut.)
 */

export interface QualitySample {
  worth: number
  grounding: number
  graph_grounding: number
  belief_alignment: number
  latency_ms: number
  input_tokens: number
  provider: string
  model: string
  task: string
  ts: string
}

const _samples: QualitySample[] = []
const RING = 500

export function recordQualitySample(s: QualitySample): void {
  _samples.push(s)
  if (_samples.length > RING) _samples.shift()
}

export function qualitySamples(): QualitySample[] { return _samples.slice() }

/** Prune the in-memory quality corpus (used by /api/self/reset). Returns count cleared. */
export function resetQuality(): number { const n = _samples.length; _samples.length = 0; return n }

// Persistence so the quality corpus compounds across restarts.
export function serializeQuality(): string { return JSON.stringify(_samples) }
export function hydrateQuality(json: string): number {
  try {
    const arr = JSON.parse(json) as QualitySample[]
    _samples.splice(0, _samples.length, ...arr.slice(-RING))
    return _samples.length
  } catch { return 0 }
}

// ── Pure stats ────────────────────────────────────────────────────────────────

/** Pearson correlation of two equal-length series. 0 if undefined (no variance). */
export function pearson(xs: number[], ys: number[]): number {
  const n = Math.min(xs.length, ys.length)
  if (n < 2) return 0
  let sx = 0, sy = 0
  for (let i = 0; i < n; i++) { sx += xs[i]!; sy += ys[i]! }
  const mx = sx / n, my = sy / n
  let cov = 0, vx = 0, vy = 0
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - mx, dy = ys[i]! - my
    cov += dx * dy; vx += dx * dx; vy += dy * dy
  }
  if (vx === 0 || vy === 0) return 0
  return cov / Math.sqrt(vx * vy)
}

export interface DriverResult {
  samples: number
  /** Features ranked by absolute correlation with worth. */
  drivers: Array<{ feature: string; correlation: number }>
  /** Plain-language reading of the dominant driver. */
  summary: string
}

const FEATURES: Array<keyof QualitySample> = ['grounding', 'graph_grounding', 'belief_alignment', 'latency_ms', 'input_tokens']

export interface WorthTrend {
  buckets: Array<{ index: number; n: number; avg_worth: number; avg_grounding: number; from: string; to: string }>
  /** avg worth of the most recent bucket minus the oldest — >0 means quality is compounding. */
  delta: number
  improving: boolean
  samples: number
}

/**
 * Bucket worth over time (chronological) so the compounding loop is *observable*:
 * is answer quality actually trending up as the self-model and graph accrete?
 */
export function worthTrend(nBuckets = 5, samples: QualitySample[] = _samples): WorthTrend {
  const sorted = samples.slice().sort((a, b) => a.ts.localeCompare(b.ts))
  if (sorted.length < nBuckets) {
    return { buckets: [], delta: 0, improving: false, samples: sorted.length }
  }
  const size = Math.floor(sorted.length / nBuckets)
  const buckets = []
  for (let i = 0; i < nBuckets; i++) {
    const slice = i === nBuckets - 1 ? sorted.slice(i * size) : sorted.slice(i * size, (i + 1) * size)
    const n = slice.length
    const avg = (sel: (s: QualitySample) => number) => n ? slice.reduce((a, s) => a + sel(s), 0) / n : 0
    buckets.push({
      index: i, n,
      avg_worth: Number(avg((s) => s.worth).toFixed(3)),
      avg_grounding: Number(avg((s) => s.grounding).toFixed(3)),
      from: slice[0]!.ts, to: slice[n - 1]!.ts,
    })
  }
  const delta = Number((buckets[buckets.length - 1]!.avg_worth - buckets[0]!.avg_worth).toFixed(3))
  return { buckets, delta, improving: delta > 0.02, samples: sorted.length }
}

export function analyzeDrivers(samples: QualitySample[] = _samples): DriverResult {
  if (samples.length < 3) {
    return { samples: samples.length, drivers: [], summary: 'not enough samples yet (need ≥3)' }
  }
  const worth = samples.map((s) => s.worth)
  const drivers = FEATURES.map((f) => ({
    feature: String(f),
    correlation: Number(pearson(samples.map((s) => Number(s[f])), worth).toFixed(3)),
  })).sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation))

  const top = drivers[0]
  const summary = top && Math.abs(top.correlation) >= 0.3
    ? `answer quality is most driven by ${top.feature} (r=${top.correlation}); ${top.correlation > 0 ? 'increase it' : 'reduce it'} to improve worth`
    : 'no strong single driver of answer quality yet'
  return { samples: samples.length, drivers, summary }
}
