/**
 * entity-risk.ts — Quantexa-style contextual entity scoring. Static GDS metrics aren't a triage signal on
 * their own; this fuses them into ONE explainable, per-entity risk/relevance score that re-ranks alerts using
 * the surrounding network — and says WHY. Deterministic, weighted, transparent.
 */
export interface EntitySignals {
  pagerank?: number        // 0..1 importance
  betweenness?: number     // 0..1 brokerage
  degree?: number          // raw connection count
  community?: number       // -1 = orphan
  anomalyFlags?: string[]  // e.g. ['orphaned_artifact','critical_dependency_failed']
}

export interface RiskFactor { factor: string; contribution: number }

const WEIGHTS = { pagerank: 0.3, betweenness: 0.3, isolation: 0.2, anomaly: 0.2 }

/** Explainable risk score in [0,1] with per-factor contributions. */
export function entityRiskScore(s: EntitySignals): { score: number; factors: RiskFactor[] } {
  const factors: RiskFactor[] = []
  const pr = Math.min(1, s.pagerank ?? 0)
  factors.push({ factor: 'importance', contribution: Number((WEIGHTS.pagerank * pr).toFixed(4)) })
  const bw = Math.min(1, s.betweenness ?? 0)
  factors.push({ factor: 'brokerage', contribution: Number((WEIGHTS.betweenness * bw).toFixed(4)) })
  const isolation = (s.community != null && s.community < 0) || (s.degree != null && s.degree <= 1) ? 1 : 0
  factors.push({ factor: 'isolation', contribution: Number((WEIGHTS.isolation * isolation).toFixed(4)) })
  const anomaly = Math.min(1, (s.anomalyFlags?.length ?? 0) / 2)
  factors.push({ factor: 'anomaly', contribution: Number((WEIGHTS.anomaly * anomaly).toFixed(4)) })
  const score = Number(factors.reduce((sum, f) => sum + f.contribution, 0).toFixed(4))
  return { score, factors: factors.sort((a, b) => b.contribution - a.contribution) }
}
