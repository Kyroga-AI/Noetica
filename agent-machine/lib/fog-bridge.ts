/**
 * fog-bridge.ts — REAL conformance to the cloudshell-fog placement/trust contracts (NOT a parallel vocabulary).
 *
 * Noetica already self-identifies as a CITIZEN_FOG node (sovereign local compute) and brokers compute across
 * providers (lib/cloud-broker.ts), and scope-d carries the mesh tier. But cloudshell-fog
 * (SociOS-Linux/cloudshell-fog) independently defines its own placement + trust-tier vocabulary
 * (docs/spec/fog-placement-v0.md, fog-trust-tier-profile-v0.md). Those two were drifting as parallel
 * vocabularies for the SAME fog-placement-trust concept.
 *
 * This bridge pins the mapping so they can't drift — exactly the role lib/gaia-bridge.ts plays for the GAIA
 * ontology. It maps Noetica's MeshTier + broker quotes onto cloudshell-fog's:
 *   - trust tiers   (fog-trust-tier-profile-v0 §1): attested_fog > managed_cloud > unverified > quarantined
 *   - placement entity (fog-placement-v0 §1): node_id, region, tier(fog|cloud), healthy, latency_ms, trust_tier, locality/sovereignty
 *   - hard filters + trust-aware ranking (fog-placement-v0 §2 + trust-tier §2)
 *   - scope→minimum-trust profiles (trust-tier §3): high-assurance (CITIZEN_FOG) = attested_fog only.
 *
 * Pure + offline (no fog runtime exists yet — cloudshell-fog is spec-stage). The conformance test exercises the
 * exact spec vocabulary, so if either side renames a tier the test breaks loudly.
 */

import type { MeshTier } from './scope-d.js'

// ── cloudshell-fog vocabulary (verbatim from the v0 specs; the single source of truth) ──────────────
/** fog-trust-tier-profile-v0 §1 — runtime trustworthiness, NOT mere reachability. Ordered low→high. */
export type FogTrustTier = 'quarantined' | 'unverified' | 'managed_cloud' | 'attested_fog'
/** fog-placement-v0 §1 — the placement plane a candidate sits on. */
export type FogPlane = 'fog' | 'cloud'
/** Noetica's Identity-Is-Prime citizen scopes (scope-d `scope` field). */
export type CitizenScope = 'CITIZEN_FOG' | 'CITIZEN_CLOUD' | 'INSTITUTION'

const TRUST_ORDER: readonly FogTrustTier[] = ['quarantined', 'unverified', 'managed_cloud', 'attested_fog']

export const trustRank = (t: FogTrustTier): number => TRUST_ORDER.indexOf(t)
/** Does a node's trust tier meet a required minimum? (fog-placement-v0 §2 hard filter). */
export const meetsTrust = (node: FogTrustTier, min: FogTrustTier): boolean => trustRank(node) >= trustRank(min)

// ── Noetica → cloudshell-fog mappings ───────────────────────────────────────────────────────────────
/**
 * MeshTier → fog trust tier. The split is edge-local ATTESTATION vs managed-cloud controls:
 *   local / sovereign-host  → attested_fog  (edge-local, sovereign — the CITIZEN_FOG node itself)
 *   open-provider / frontier → managed_cloud (reachable + managed, but no edge-local attestation)
 * An unhealthy node is `quarantined` regardless of tier (trust-tier §1: reachable ≠ acceptable).
 */
export function meshTierToFogTrust(t: MeshTier, opts: { healthy?: boolean } = {}): FogTrustTier {
  if (opts.healthy === false) return 'quarantined'
  switch (t) {
    case 'local':
    case 'sovereign-host':
      return 'attested_fog'
    case 'open-provider':
    case 'frontier':
      return 'managed_cloud'
  }
}

/** MeshTier → placement plane (fog-placement-v0 §1 `tier`). */
export function meshTierToPlane(t: MeshTier): FogPlane {
  return t === 'local' || t === 'sovereign-host' ? 'fog' : 'cloud'
}

/**
 * Citizen scope → minimum acceptable trust tier (fog-trust-tier-profile-v0 §3 request profiles).
 *   CITIZEN_FOG  = high-assurance/sovereign → attested_fog only
 *   CITIZEN_CLOUD / INSTITUTION = default → managed_cloud or better
 */
export function scopeMinTrust(scope: CitizenScope): FogTrustTier {
  return scope === 'CITIZEN_FOG' ? 'attested_fog' : 'managed_cloud'
}

// ── placement candidate (fog-placement-v0 §1) ────────────────────────────────────────────────────────
export interface FogPlacementCandidate {
  node_id: string
  region: string
  tier: FogPlane
  healthy: boolean
  trust_tier: FogTrustTier
  latency_ms?: number
  locality?: string
  sovereignty?: string
  /** Noetica cost passthrough (broker extension; not required by the spec). */
  usd_per_hour?: number
  spot?: boolean
}

/** Minimal structural shape of a Noetica broker quote (avoids a hard import; matches cloud-broker BrokerQuote). */
export interface BrokerQuoteLike {
  sku: { provider: string; name?: string; region: string; usdPerHour?: number }
  effectivePerHour?: number
  spot?: boolean
}

/**
 * A Noetica broker quote → a cloudshell-fog placement candidate. `meshTierOf` maps the quote's provider to a
 * MeshTier (e.g. 'local' → local, a sovereign-approved cloud → sovereign-host, AWS/GCP → open-provider).
 */
export function quoteToPlacement(
  q: BrokerQuoteLike,
  meshTierOf: (provider: string) => MeshTier,
  extra: { latencyMs?: number; healthy?: boolean; locality?: string; sovereignty?: string } = {},
): FogPlacementCandidate {
  const mt = meshTierOf(q.sku.provider)
  const healthy = extra.healthy ?? true
  return {
    node_id: q.sku.name ? `${q.sku.provider}:${q.sku.name}` : q.sku.provider,
    region: q.sku.region,
    tier: meshTierToPlane(mt),
    healthy,
    trust_tier: meshTierToFogTrust(mt, { healthy }),
    ...(extra.latencyMs != null ? { latency_ms: extra.latencyMs } : {}),
    ...(extra.locality ? { locality: extra.locality } : {}),
    ...(extra.sovereignty ? { sovereignty: extra.sovereignty } : {}),
    ...(q.effectivePerHour ?? q.sku.usdPerHour) != null ? { usd_per_hour: q.effectivePerHour ?? q.sku.usdPerHour } : {},
    ...(q.spot != null ? { spot: q.spot } : {}),
  }
}

export interface FogPlacementRequest {
  /** Minimum acceptable trust tier — typically `scopeMinTrust(scope)`. */
  minTrust: FogTrustTier
  /** Hard locality/sovereignty bound (fog-placement-v0 §2). */
  locality?: string
  sovereignty?: string
  /** Cap on estimated latency (ms). */
  maxLatencyMs?: number
}

export interface FogPlacementResult {
  chosen: FogPlacementCandidate | null
  eligible: FogPlacementCandidate[]
  rejected: { node_id: string; reason: string }[]
}

/**
 * Placement decision (fog-placement-v0 §2 hard filters + fog-trust-tier-profile-v0 §2 "trust is a scoring input,
 * not just an audit tag"). Hard-filters unhealthy / below-min-trust / out-of-locality / over-latency, then ranks
 * eligible candidates by trust tier (desc), then latency (asc), then cost (asc). Local-first by construction:
 * attested_fog outranks managed_cloud, so a healthy fog node always wins a tie against cloud.
 */
export function placeFog(candidates: FogPlacementCandidate[], req: FogPlacementRequest): FogPlacementResult {
  const rejected: { node_id: string; reason: string }[] = []
  const eligible = candidates.filter((c) => {
    if (!c.healthy) { rejected.push({ node_id: c.node_id, reason: 'unhealthy' }); return false }
    if (!meetsTrust(c.trust_tier, req.minTrust)) { rejected.push({ node_id: c.node_id, reason: `trust ${c.trust_tier} < min ${req.minTrust}` }); return false }
    if (req.locality && c.locality && c.locality !== req.locality) { rejected.push({ node_id: c.node_id, reason: 'outside locality' }); return false }
    if (req.sovereignty && c.sovereignty && c.sovereignty !== req.sovereignty) { rejected.push({ node_id: c.node_id, reason: 'outside sovereignty' }); return false }
    if (req.maxLatencyMs != null && c.latency_ms != null && c.latency_ms > req.maxLatencyMs) { rejected.push({ node_id: c.node_id, reason: 'over latency budget' }); return false }
    return true
  })
  eligible.sort((a, b) =>
    trustRank(b.trust_tier) - trustRank(a.trust_tier) ||
    (a.latency_ms ?? Infinity) - (b.latency_ms ?? Infinity) ||
    (a.usd_per_hour ?? Infinity) - (b.usd_per_hour ?? Infinity),
  )
  return { chosen: eligible[0] ?? null, eligible, rejected }
}

// ── conformance check (fog-placement-v0 §1 required fields) ──────────────────────────────────────────
const REQUIRED: (keyof FogPlacementCandidate)[] = ['node_id', 'region', 'tier', 'healthy', 'trust_tier']

/** Lightweight, offline conformance check against the fog-placement-v0 placement-entity contract. */
export function conformsToFogPlacement(c: FogPlacementCandidate): { conforms: boolean; missing: string[] } {
  const missing = REQUIRED.filter((k) => c[k] == null || c[k] === '').map(String)
  if (c.tier && c.tier !== 'fog' && c.tier !== 'cloud') missing.push('tier(invalid)')
  if (c.trust_tier && trustRank(c.trust_tier) < 0) missing.push('trust_tier(invalid)')
  return { conforms: missing.length === 0, missing }
}
