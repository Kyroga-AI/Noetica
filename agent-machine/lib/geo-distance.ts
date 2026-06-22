/** geo-distance.ts — haversine great-circle distance (metres) + point-in-polygon, shared geo primitives. */
const R = 6_371_000   // earth radius, metres

export function haversine(a: { lon: number; lat: number }, b: { lon: number; lat: number }): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat), dLon = toRad(b.lon - a.lon)
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)))
}

/** Ray-casting point-in-polygon. Polygon is a closed ring of [lon, lat]. */
export function pointInPolygon(pt: { lon: number; lat: number }, ring: Array<[number, number]>): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!, [xj, yj] = ring[j]!
    const intersect = (yi > pt.lat) !== (yj > pt.lat) && pt.lon < ((xj - xi) * (pt.lat - yi)) / (yj - yi) + xi
    if (intersect) inside = !inside
  }
  return inside
}
