/** Tests for the live-pricing merge (no network — the Azure fetch is integration-only). */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mergeLivePrices, type LivePrice } from './cloud-pricing.js'
import { COMPUTE_CATALOG } from './cloud-broker.js'

test('mergeLivePrices overrides on-demand + spot for matched SKUs, leaves others untouched', () => {
  const live: LivePrice[] = [
    { provider: 'azure', skuName: 'NC24ads_A100_v4', region: 'eastus', usdPerHour: 2.99 },
    { provider: 'azure', skuName: 'NC24ads_A100_v4', region: 'eastus', usdPerHour: 1.10, spot: true },
  ]
  const merged = mergeLivePrices(COMPUTE_CATALOG, live)
  const az = merged.find((s) => s.provider === 'azure' && s.name === 'NC24ads_A100_v4')!
  assert.equal(az.usdPerHour, 2.99, 'live on-demand applied')
  assert.equal(az.spotPerHour, 1.10, 'live spot applied')
  // an unmatched SKU is unchanged
  const gcp = merged.find((s) => s.provider === 'gcp' && s.name === 'a2-ultragpu-1g')!
  const orig = COMPUTE_CATALOG.find((s) => s.provider === 'gcp' && s.name === 'a2-ultragpu-1g')!
  assert.equal(gcp.usdPerHour, orig.usdPerHour)
})

test('mergeLivePrices with no live data is a no-op', () => {
  const merged = mergeLivePrices(COMPUTE_CATALOG, [])
  assert.deepEqual(merged, COMPUTE_CATALOG)
})
