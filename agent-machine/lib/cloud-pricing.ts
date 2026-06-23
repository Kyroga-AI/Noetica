/**
 * cloud-pricing.ts — live pricing adapters for the multi-cloud broker. The static COMPUTE_CATALOG ranks fine
 * but goes stale; this refreshes real on-demand/spot prices from provider billing APIs and merges them over
 * the catalogue. Azure's Retail Prices API is PUBLIC (no auth) so it's wired for real here; AWS Price List /
 * GCP Cloud Billing Catalog / IBM need credentials and are structured stubs the same shape can fill.
 *
 * Design: best-effort + cached + fail-safe — a pricing fetch that errors or times out leaves the static
 * catalogue untouched (a broker must never block or quote nothing because a billing API hiccuped).
 */
import type { ComputeSku } from './cloud-broker.js'

export interface LivePrice { provider: 'azure' | 'aws' | 'gcp' | 'ibm'; skuName: string; region: string; usdPerHour: number; spot?: boolean }

interface AzureRetailItem { armSkuName?: string; retailPrice?: number; unitOfMeasure?: string; armRegionName?: string; meterName?: string; type?: string; serviceName?: string }

/** Map an Azure SKU/meter name back onto our catalogue SKU names (the broker's keys). */
const AZURE_SKU_MAP: Record<string, string> = {
  'Standard_NC24ads_A100_v4': 'NC24ads_A100_v4',
  'Standard_NV36ads_A10_v5': 'NV36ads_A10_v5',
  'Standard_D8s_v5': 'D8s_v5',
}

/**
 * Fetch live Azure prices for our catalogue SKUs via the PUBLIC Retail Prices API (no auth). Returns the
 * lowest matching Consumption price per SKU (and a Spot price if present). Never throws.
 */
export async function fetchAzurePricing(region = 'eastus', timeoutMs = 8000): Promise<LivePrice[]> {
  const skus = Object.keys(AZURE_SKU_MAP)
  const filter = `serviceName eq 'Virtual Machines' and armRegionName eq '${region}' and priceType eq 'Consumption' and (${skus.map((s) => `armSkuName eq '${s}'`).join(' or ')})`
  const url = `https://prices.azure.com/api/retail/prices?$filter=${encodeURIComponent(filter)}`
  try {
    const out: LivePrice[] = []
    let next: string | null = url
    let pages = 0
    while (next && pages < 5) {
      const r: Response = await fetch(next, { signal: AbortSignal.timeout(timeoutMs) })
      if (!r.ok) break
      const j = (await r.json()) as { Items?: AzureRetailItem[]; NextPageLink?: string | null }
      for (const it of j.Items ?? []) {
        const mapped = it.armSkuName ? AZURE_SKU_MAP[it.armSkuName] : undefined
        if (!mapped || typeof it.retailPrice !== 'number' || it.retailPrice <= 0) continue
        if (!/hour/i.test(it.unitOfMeasure ?? '')) continue
        const spot = /spot/i.test(it.meterName ?? '') || /spot/i.test(it.type ?? '')
        out.push({ provider: 'azure', skuName: mapped, region: it.armRegionName ?? region, usdPerHour: it.retailPrice, spot })
      }
      next = j.NextPageLink ?? null
      pages++
    }
    return dedupeLowest(out)
  } catch { return [] }
}

/** Keep the lowest on-demand price and lowest spot price per (provider, skuName). */
function dedupeLowest(prices: LivePrice[]): LivePrice[] {
  const byKey = new Map<string, LivePrice>()
  for (const p of prices) {
    const key = `${p.provider}:${p.skuName}:${p.spot ? 'spot' : 'od'}`
    const cur = byKey.get(key)
    if (!cur || p.usdPerHour < cur.usdPerHour) byKey.set(key, p)
  }
  return [...byKey.values()]
}

/** Merge live prices over a static catalogue (by provider+SKU name), updating usdPerHour / spotPerHour. */
export function mergeLivePrices(catalog: ComputeSku[], live: LivePrice[]): ComputeSku[] {
  const od = new Map<string, number>(), spot = new Map<string, number>()
  for (const p of live) (p.spot ? spot : od).set(`${p.provider}:${p.skuName}`, p.usdPerHour)
  return catalog.map((s) => {
    const k = `${s.provider}:${s.name}`
    const o = od.get(k), sp = spot.get(k)
    return (o == null && sp == null) ? s : { ...s, ...(o != null ? { usdPerHour: o } : {}), ...(sp != null ? { spotPerHour: sp } : {}) }
  })
}

// Process-cached live catalogue (5-min TTL via the caller passing a clock; here a simple in-memory guard).
let _cache: { at: number; live: LivePrice[] } | null = null
/** Refresh live prices (Azure today), cached ~5 min. `now` injected for testability. */
export async function refreshLivePrices(now: number, region = 'eastus'): Promise<LivePrice[]> {
  if (_cache && now - _cache.at < 5 * 60_000) return _cache.live
  const live = await fetchAzurePricing(region)
  if (live.length) _cache = { at: now, live }
  return live
}
