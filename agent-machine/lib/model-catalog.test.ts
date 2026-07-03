import { test } from 'node:test'
import assert from 'node:assert/strict'
import { modelCatalog, routeToTier, SOCIOS_LABS } from './model-catalog.js'

test('Apple-aligned: one ~3B on-device base + one adapter per SociOS lab + a larger server', () => {
  const { models } = modelCatalog()
  const base = models.find((m) => m.id === 'base.on-device')!
  assert.equal(base.kind, 'base')
  assert.equal(base.tier, 'on-device')
  assert.ok(base.paramsB <= 3.5 && base.paramsB >= 2, 'on-device base ~3B (Apple)')
  assert.match(base.quantization ?? '', /bit/)

  const adapters = models.filter((m) => m.kind === 'adapter')
  assert.equal(adapters.length, SOCIOS_LABS.length)
  assert.ok(adapters.every((a) => a.tier === 'on-device' && a.paramsB < 1), 'adapters are small + on-device')
  assert.deepEqual(new Set(adapters.map((a) => a.modality)), new Set(SOCIOS_LABS.map((l) => l.modality)))

  const server = models.find((m) => m.tier === 'server')!
  assert.ok(server.paramsB > base.paramsB, 'server tier is larger (Apple PCC)')
})

test('spec-conformant residency + carry fields present', () => {
  for (const m of modelCatalog().models) {
    assert.ok(['unavailable', 'downloadable', 'cached', 'loading', 'loaded-cold', 'loaded-warm', 'pinned', 'evictable', 'failed'].includes(m.residencyState))
    assert.ok(['reference-only', 'download-on-demand', 'preload-reference', 'disabled'].includes(m.carryPolicy))
    assert.ok(['ram', 'nvme', 'object-store', 'network-cache', 'none'].includes(m.cacheTier))
  }
})

test('routing by sensitivity: high stays on-device, low may reach the server (Apple privacy tier)', () => {
  assert.equal(routeToTier('high'), 'on-device')
  assert.equal(routeToTier('medium'), 'edge')
  assert.equal(routeToTier('low'), 'server')
})
