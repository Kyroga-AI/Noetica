/**
 * movement.ts — stay-point (stop) detection from location pings. Collapses a raw GPS trace into the places an
 * entity actually DWELLED (a cluster of consecutive pings within a radius for at least a min duration) — the
 * basis of pattern-of-life and co-location. Movement between stops becomes the trajectory.
 */
import { haversine } from './geo-distance.js'

export interface Ping { lon: number; lat: number; t: number }
export interface Stop { lon: number; lat: number; from: number; to: number; durationMs: number; pings: number }

/** Detect stops: consecutive pings staying within maxMeters for at least minDwellMs. */
export function detectStops(pings: Ping[], opts: { maxMeters?: number; minDwellMs?: number } = {}): Stop[] {
  const maxMeters = opts.maxMeters ?? 100
  const minDwellMs = opts.minDwellMs ?? 5 * 60_000
  const sorted = [...pings].sort((a, b) => a.t - b.t)
  const stops: Stop[] = []
  let i = 0
  while (i < sorted.length) {
    let j = i + 1
    while (j < sorted.length && haversine(sorted[i]!, sorted[j]!) <= maxMeters) j++
    const cluster = sorted.slice(i, j)
    const durationMs = cluster[cluster.length - 1]!.t - cluster[0]!.t
    if (cluster.length >= 2 && durationMs >= minDwellMs) {
      const lon = cluster.reduce((s, p) => s + p.lon, 0) / cluster.length
      const lat = cluster.reduce((s, p) => s + p.lat, 0) / cluster.length
      stops.push({ lon, lat, from: cluster[0]!.t, to: cluster[cluster.length - 1]!.t, durationMs, pings: cluster.length })
      i = j
    } else i++
  }
  return stops
}
