/**
 * geo-cells.ts — lightweight spatial-cell index (the H3 role, no native dep). Quantizes lon/lat to a grid
 * cell at a chosen resolution so points can be binned, rolled up, and joined — the substrate co-location and
 * spatiotemporal anomaly build on. (True Uber H3 hexes are the upgrade; this is a deterministic square-cell
 * stand-in that needs zero dependencies and runs anywhere.)
 */
export function cellId(lon: number, lat: number, res = 0.01): string {
  const q = (v: number) => Math.round(v / res)
  return `c:${q(lon)}:${q(lat)}:${res}`
}

export function cellCenter(id: string): { lon: number; lat: number } {
  const [, qx, qy, res] = id.split(':')
  return { lon: Number(qx) * Number(res), lat: Number(qy) * Number(res) }
}

export function aggregateByCell<T extends { lon: number; lat: number }>(points: T[], res = 0.01): Map<string, T[]> {
  const m = new Map<string, T[]>()
  for (const p of points) {
    const id = cellId(p.lon, p.lat, res)
    ;(m.get(id) ?? m.set(id, []).get(id)!).push(p)
  }
  return m
}

/** k-ring neighbourhood of a cell (Chebyshev distance ≤ k). */
export function kRing(id: string, k = 1): string[] {
  const [, qx, qy, res] = id.split(':')
  const out: string[] = []
  for (let dx = -k; dx <= k; dx++) for (let dy = -k; dy <= k; dy++) out.push(`c:${Number(qx) + dx}:${Number(qy) + dy}:${res}`)
  return out
}
