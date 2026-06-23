/** Tests for the multi-cloud compute broker. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { brokerCompute, brokerSavings, COMPUTE_CATALOG } from './cloud-broker.js'

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
