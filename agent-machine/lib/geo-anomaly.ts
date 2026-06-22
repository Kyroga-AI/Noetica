/**
 * geo-anomaly.ts — emerging-hotspot / spatiotemporal anomaly detection. Builds a per-cell baseline of
 * activity and flags cells where RECENT activity deviates (intensifying = emerging hotspot, fading = cooling).
 * A statistical complement to our topological anomalies (bridges/orphans), which have no space-time notion.
 */
import { cellId } from './geo-cells.js'

export interface GeoEvent { lon: number; lat: number; t: number }   // t = epoch ms

export interface Hotspot { cell: string; recent: number; baselineMean: number; z: number; trend: 'emerging' | 'cooling' | 'stable' }

/**
 * For each cell, compare its event count in the recent window against the per-bucket baseline (earlier
 * windows of the same span). z = (recent − mean) / std. |z| ≥ minZ ⇒ emerging (>0) / cooling (<0).
 */
export function emergingHotspots(events: GeoEvent[], opts: { now: number; windowMs?: number; res?: number; minZ?: number }): Hotspot[] {
  const windowMs = opts.windowMs ?? 24 * 3_600_000
  const res = opts.res ?? 0.05
  const minZ = opts.minZ ?? 1.5
  const recentStart = opts.now - windowMs
  // per cell: counts per historical bucket + the recent count
  const cells = new Map<string, { recent: number; hist: Map<number, number> }>()
  for (const e of events) {
    const c = cellId(e.lon, e.lat, res)
    const rec = cells.get(c) ?? cells.set(c, { recent: 0, hist: new Map() }).get(c)!
    if (e.t >= recentStart) rec.recent++
    else { const b = Math.floor(e.t / windowMs); rec.hist.set(b, (rec.hist.get(b) ?? 0) + 1) }
  }
  const out: Hotspot[] = []
  for (const [cell, { recent, hist }] of cells) {
    const counts = [...hist.values()]
    const n = counts.length
    const mean = n ? counts.reduce((s, x) => s + x, 0) / n : 0
    const variance = n ? counts.reduce((s, x) => s + (x - mean) ** 2, 0) / n : 0
    const std = Math.sqrt(variance) || 1
    const z = (recent - mean) / std
    const trend: Hotspot['trend'] = z >= minZ ? 'emerging' : z <= -minZ ? 'cooling' : 'stable'
    if (trend !== 'stable') out.push({ cell, recent, baselineMean: Number(mean.toFixed(2)), z: Number(z.toFixed(2)), trend })
  }
  return out.sort((a, b) => Math.abs(b.z) - Math.abs(a.z))
}
