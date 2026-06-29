/** Tests for the multi-cloud compute broker. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { brokerCompute, brokerSavings, toFogPlacements, brokerFogPlacement, COMPUTE_CATALOG } from './cloud-broker.js'

test('brokers an A100 workload to the cheapest satisfying cloud', () => {
  const r = brokerCompute({ gpu: { type: 'A100', count: 1 }, hours: 10, excludeLocal: true })
  assert.ok(r.best, 'a best quote exists')
  assert.equal(r.best!.sku.gpu?.type.includes('A100'), true)
  // every ranked option must actually satisfy + be sorted ascending by total cost
  for (let i = 1; i < r.ranked.length; i++) assert.ok(r.ranked[i]!.totalUsd >= r.ranked[i - 1]!.totalUsd)
  // Azure NC24ads A100 (3.67/hr) is the cheapest on-demand A100 in the catalogue
  assert.equal(r.best!.sku.provider, 'azure')
  assert.equal(r.best!.totalUsd, 36.7)
})

test('local mesh wins on cost ($0) unless excluded', () => {
  const withLocal = brokerCompute({ gpu: { count: 1 }, hours: 5 })
  assert.equal(withLocal.best!.sku.provider, 'local')
  assert.equal(withLocal.best!.totalUsd, 0)
  const cloudOnly = brokerCompute({ gpu: { count: 1 }, hours: 5, excludeLocal: true })
  assert.notEqual(cloudOnly.best!.sku.provider, 'local')
})

test('spot pricing is cheaper than on-demand and is used when requested', () => {
  const od = brokerCompute({ gpu: { type: 'A100', count: 1 }, hours: 10, excludeLocal: true })
  const spot = brokerCompute({ gpu: { type: 'A100', count: 1 }, hours: 10, excludeLocal: true, spot: true })
  assert.ok(spot.best!.totalUsd < od.best!.totalUsd, 'spot beats on-demand')
  assert.equal(spot.best!.spot, true)
})

test('provider allow-list restricts the broker (sovereign-approved clouds only)', () => {
  const r = brokerCompute({ vcpus: 8, hours: 1, providers: ['gcp', 'ibm'] })
  assert.ok(r.ranked.every((q) => q.sku.provider === 'gcp' || q.sku.provider === 'ibm'))
})

test('rejects SKUs that do not meet the resource floor', () => {
  const r = brokerCompute({ gpu: { count: 1, minMemGiB: 80 }, hours: 1, excludeLocal: true })
  assert.ok(r.ranked.every((q) => (q.sku.gpu?.memGiB ?? 0) >= 80), 'only ≥80GB GPUs')
})

test('brokerSavings reports the spread between cheapest and dearest', () => {
  const r = brokerCompute({ gpu: { type: 'A100', count: 1 }, hours: 10, excludeLocal: true })
  const s = brokerSavings(r)
  assert.ok(s.absUsd > 0 && s.pct > 0)
})

test('catalogue covers all four major clouds + local', () => {
  const providers = new Set(COMPUTE_CATALOG.map((s) => s.provider))
  for (const p of ['gcp', 'azure', 'aws', 'ibm', 'local']) assert.ok(providers.has(p as never), `${p} present`)
})

test('toAgentplanePlacement emits an agentplane-conformant PlacementDecision filling the cost objective', () => {
  const { toAgentplanePlacement } = require('./cloud-broker.js') as typeof import('./cloud-broker.js')
  const r = brokerCompute({ gpu: { type: 'A100', count: 1 }, hours: 10, excludeLocal: true, spot: true })
  const p = toAgentplanePlacement(r, { lane: 'prod' })
  assert.equal(p.apiVersion, 'agentplane.socioprophet.org/v0.1')
  assert.equal(p.kind, 'PlacementDecision')
  assert.equal(p.lane, 'prod')
  assert.equal(p.effectiveBackend, 'cloud-gpu')
  assert.equal(p.objective.metric, 'usd-total')
  assert.ok(p.objective.value > 0 && p.objective.spot === true)
  assert.ok(p.chosenExecutor?.startsWith('azure:'))
  assert.ok(p.rejected.length >= 1 && p.rejected[0]!.reason.startsWith('dearer'))
})

// ── commodity services broker ──
import { selectVendor, compareServices, mapResource } from './cloud-broker.js'

test('maps an abstract commodity to each vendor primitive (object-store → S3/GCS/Blob)', () => {
  assert.equal(mapResource('object-store', 'aws'), 'S3')
  assert.equal(mapResource('object-store', 'gcp'), 'Cloud Storage')
  assert.equal(mapResource('object-store', 'azure'), 'Blob Storage')
})

test('selects the cheapest vendor for a commodity (and honors exclude)', () => {
  assert.equal(selectVendor({ kind: 'object-store' })!.provider, 'hetzner') // $0.005
  assert.equal(selectVendor({ kind: 'object-store', exclude: ['hetzner'] })!.provider, 'nebius') // next at $0.008
})

test('data-residency is a hard constraint (EU-only object store narrows the field)', () => {
  const eu = selectVendor({ kind: 'object-store', residency: 'EU' })
  assert.ok(eu && eu.offering.residency.includes('EU'))
  const au = selectVendor({ kind: 'object-store', residency: 'AU' })
  assert.ok(au && au.provider !== 'hetzner', 'hetzner has no AU residency → excluded')
})

test('compareServices returns the panel list, cheapest first; no-match → null', () => {
  const list = compareServices('kubernetes')
  for (let i = 1; i < list.length; i++) assert.ok(list[i].unitPriceUsd >= list[i - 1].unitPriceUsd)
  assert.equal(selectVendor({ kind: 'object-store', maxPriceUsd: 0.001 }), null)
})

// ── neocloud brokering ──
import { NEOCLOUDS } from './cloud-broker.js'

test('brokers an H100 to a NeoCloud (the cheap-GPU layer), beating hyperscaler GPU', () => {
  const r = brokerCompute({ gpu: { type: 'H100', count: 1 }, hours: 100, excludeLocal: true })
  assert.ok(r.best, 'found an H100')
  assert.ok((NEOCLOUDS as string[]).includes(r.best!.sku.provider), `cheapest H100 is a neocloud, got ${r.best!.sku.provider}`)
  assert.ok(r.best!.effectivePerHour <= 2.0, 'neocloud H100 ~$2/hr')
})

test('can restrict to neoclouds only (sovereign-approved GPU supply)', () => {
  const r = brokerCompute({ gpu: { count: 1 }, hours: 10, providers: NEOCLOUDS })
  assert.ok(r.best && (NEOCLOUDS as string[]).includes(r.best.sku.provider))
  assert.ok(r.ranked.every((q) => (NEOCLOUDS as string[]).includes(q.sku.provider)))
})

test('toFogPlacements renders broker quotes as conformant cloudshell-fog candidates', () => {
  const r = brokerCompute({ gpu: { type: 'A100', count: 1 }, hours: 10 })   // includes local
  const fps = toFogPlacements(r)
  assert.equal(fps.length, r.ranked.length)
  // every candidate carries the fog-placement-v0 required fields
  for (const c of fps) { assert.ok(c.node_id && c.region && c.tier && c.trust_tier); assert.ok(c.tier === 'fog' || c.tier === 'cloud') }
  // a local quote (if present) maps to the fog plane + attested_fog; clouds → managed_cloud
  const localC = fps.find((c) => c.node_id.startsWith('local'))
  if (localC) { assert.equal(localC.tier, 'fog'); assert.equal(localC.trust_tier, 'attested_fog') }
  const cloudC = fps.find((c) => c.tier === 'cloud')
  if (cloudC) assert.equal(cloudC.trust_tier, 'managed_cloud')
})

test('brokerFogPlacement: CITIZEN_FOG forces a local/sovereign (attested_fog) node', () => {
  const r = brokerCompute({ gpu: { type: 'A100', count: 1 }, hours: 10 })
  const fog = brokerFogPlacement(r, 'CITIZEN_FOG')
  if (fog.chosen) assert.equal(fog.chosen.trust_tier, 'attested_fog')   // high-assurance rejects managed_cloud
  // CITIZEN_CLOUD accepts managed_cloud, so it has at least as many eligible candidates
  const cloud = brokerFogPlacement(r, 'CITIZEN_CLOUD')
  assert.ok(cloud.eligible.length >= fog.eligible.length)
})
