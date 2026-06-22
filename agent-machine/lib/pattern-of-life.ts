/**
 * pattern-of-life.ts — per-entity behavioral baseline + deviation detection (Palantir Gotham pattern-of-life).
 * Learns each entity's NORMAL hours-of-activity and location set, then flags departures: an off-hours event,
 * a never-before-seen location. Distinct from our topological/statistical anomalies — this is per-entity
 * behavioral normality.
 */
export interface Activity { entity: string; hour: number; place: string }
export interface Baseline { hours: Set<number>; places: Set<string>; count: number }

export function buildBaseline(history: Activity[]): Map<string, Baseline> {
  const m = new Map<string, Baseline>()
  for (const a of history) {
    const b = m.get(a.entity) ?? m.set(a.entity, { hours: new Set(), places: new Set(), count: 0 }).get(a.entity)!
    b.hours.add(a.hour); b.places.add(a.place); b.count++
  }
  return m
}

/** Deviations of a new activity from the entity's baseline. Sparse baselines (count<minObs) are skipped. */
export function deviations(activity: Activity, baselines: Map<string, Baseline>, opts: { minObs?: number } = {}): string[] {
  const minObs = opts.minObs ?? 3
  const b = baselines.get(activity.entity)
  if (!b || b.count < minObs) return []
  const out: string[] = []
  if (!b.places.has(activity.place)) out.push('new-location')
  // off-hours = no baseline hour within ±1 of this hour
  if (![...b.hours].some((h) => Math.abs(h - activity.hour) <= 1)) out.push('off-hours')
  return out
}
