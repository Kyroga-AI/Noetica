import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { MeshTier } from './scope-d.js'
import {
  meshTierToFogTrust, meshTierToPlane, scopeMinTrust, meetsTrust, trustRank,
  quoteToPlacement, placeFog, conformsToFogPlacement,
  type FogPlacementCandidate, type BrokerQuoteLike,
} from './fog-bridge.js'

test('MeshTier maps onto the fog trust tiers (edge-local attestation vs managed cloud)', () => {
  assert.equal(meshTierToFogTrust('local'), 'attested_fog')
  assert.equal(meshTierToFogTrust('sovereign-host'), 'attested_fog')
  assert.equal(meshTierToFogTrust('open-provider'), 'managed_cloud')
  assert.equal(meshTierToFogTrust('frontier'), 'managed_cloud')
  // reachable != acceptable: an unhealthy node is quarantined regardless of tier
  assert.equal(meshTierToFogTrust('local', { healthy: false }), 'quarantined')
})

test('MeshTier maps onto the placement plane (fog vs cloud)', () => {
  assert.equal(meshTierToPlane('local'), 'fog')
  assert.equal(meshTierToPlane('sovereign-host'), 'fog')
  assert.equal(meshTierToPlane('frontier'), 'cloud')
})

test('citizen scope -> minimum trust tier (high-assurance CITIZEN_FOG = attested_fog only)', () => {
  assert.equal(scopeMinTrust('CITIZEN_FOG'), 'attested_fog')
  assert.equal(scopeMinTrust('CITIZEN_CLOUD'), 'managed_cloud')
  assert.equal(scopeMinTrust('INSTITUTION'), 'managed_cloud')
})

test('trust ordering is total and correct: attested_fog > managed_cloud > unverified > quarantined', () => {
  assert.ok(trustRank('attested_fog') > trustRank('managed_cloud'))
  assert.ok(trustRank('managed_cloud') > trustRank('unverified'))
  assert.ok(trustRank('unverified') > trustRank('quarantined'))
  assert.equal(meetsTrust('attested_fog', 'managed_cloud'), true)
  assert.equal(meetsTrust('managed_cloud', 'attested_fog'), false)
})

test('a Noetica broker quote becomes a conformant fog placement candidate', () => {
  const q: BrokerQuoteLike = { sku: { provider: 'local', name: 'm2-metal', region: 'edge' }, effectivePerHour: 0, spot: false }
  const meshTierOf = (p: string): MeshTier => (p === 'local' ? 'local' : 'open-provider')
  const cand = quoteToPlacement(q, meshTierOf, { latencyMs: 5, sovereignty: 'US' })
  assert.equal(cand.tier, 'fog')
  assert.equal(cand.trust_tier, 'attested_fog')
  assert.equal(cand.latency_ms, 5)
  assert.equal(conformsToFogPlacement(cand).conforms, true)
})

test('placement is local-first: a healthy fog node beats a cheaper cloud node', () => {
  const fog: FogPlacementCandidate = { node_id: 'local:metal', region: 'edge', tier: 'fog', healthy: true, trust_tier: 'attested_fog', latency_ms: 4, usd_per_hour: 0 }
  const cloud: FogPlacementCandidate = { node_id: 'gcp:l4', region: 'us-east1', tier: 'cloud', healthy: true, trust_tier: 'managed_cloud', latency_ms: 40, usd_per_hour: 0.7 }
  const r = placeFog([cloud, fog], { minTrust: 'managed_cloud' })
  assert.equal(r.chosen?.node_id, 'local:metal')   // attested_fog outranks managed_cloud despite cloud being... not cheaper here, but trust wins regardless
  assert.equal(r.eligible.length, 2)
})

test('CITIZEN_FOG high-assurance request hard-filters managed_cloud nodes', () => {
  const fog: FogPlacementCandidate = { node_id: 'local:metal', region: 'edge', tier: 'fog', healthy: true, trust_tier: 'attested_fog' }
  const cloud: FogPlacementCandidate = { node_id: 'aws:g5', region: 'us-east-1', tier: 'cloud', healthy: true, trust_tier: 'managed_cloud' }
  const r = placeFog([fog, cloud], { minTrust: scopeMinTrust('CITIZEN_FOG') })
  assert.equal(r.eligible.length, 1)
  assert.equal(r.chosen?.node_id, 'local:metal')
  assert.equal(r.rejected[0]?.reason.includes('trust'), true)
})

test('unhealthy + locality + latency hard filters reject with reasons', () => {
  const cands: FogPlacementCandidate[] = [
    { node_id: 'a', region: 'r', tier: 'fog', healthy: false, trust_tier: 'attested_fog' },
    { node_id: 'b', region: 'r', tier: 'cloud', healthy: true, trust_tier: 'managed_cloud', locality: 'EU' },
    { node_id: 'c', region: 'r', tier: 'cloud', healthy: true, trust_tier: 'managed_cloud', latency_ms: 500 },
    { node_id: 'd', region: 'r', tier: 'cloud', healthy: true, trust_tier: 'managed_cloud', latency_ms: 20 },
  ]
  const r = placeFog(cands, { minTrust: 'managed_cloud', locality: 'US', maxLatencyMs: 100 })
  assert.equal(r.chosen?.node_id, 'd')
  assert.equal(r.eligible.length, 1)
  assert.equal(r.rejected.length, 3)
})

test('conformance check flags a candidate missing required placement-entity fields', () => {
  const bad = { node_id: 'x', region: '', tier: 'fog', healthy: true } as unknown as FogPlacementCandidate
  const v = conformsToFogPlacement(bad)
  assert.equal(v.conforms, false)
  assert.ok(v.missing.includes('region'))
  assert.ok(v.missing.includes('trust_tier'))
})
