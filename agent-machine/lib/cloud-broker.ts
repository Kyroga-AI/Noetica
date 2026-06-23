/**
 * cloud-broker.ts — Noetica as a multi-cloud RESOURCE broker. The AI provider lane (lib/router resolveProvider)
 * already brokers *inference* to the cheapest/best model; this brokers *compute* (GPU/VM) across GCP, Azure,
 * AWS, IBM (+ the local mesh), routing a workload to the cheapest provider that satisfies it. This is the
 * "command-and-control over cloud, not just AI" + "broker to cheapest resources" capability.
 *
 * The catalogue here is a representative on-demand price list (USD/hr, list prices ~2025) used for ranking +
 * estimates; a live pricing adapter (per-provider billing API) can replace COMPUTE_CATALOG without changing
 * the broker algorithm. Every brokered placement is meant to flow through scope-d egress governance.
 */
export type CloudProvider = 'gcp' | 'azure' | 'aws' | 'ibm' | 'local'

export interface ComputeSku {
  provider: CloudProvider
  name: string                       // provider SKU / instance type
  region: string
  vcpus: number
  memGiB: number
  gpu?: { type: string; count: number; memGiB: number }
  usdPerHour: number                 // on-demand list price
  spotPerHour?: number               // spot / preemptible price (interruptible)
  priceSource?: 'live' | 'list'      // 'live' = real-time billing API (Azure Retail today); 'list' = static estimate
}

// Representative cross-cloud GPU + CPU catalogue (on-demand list, USD/hr). Prices are approximate and meant
// for ranking; swap in a live billing-API adapter for exact quotes.
export const COMPUTE_CATALOG: ComputeSku[] = [
  // ── A100 80GB (single-GPU) ──
  { provider: 'gcp',   name: 'a2-ultragpu-1g',      region: 'us-central1', vcpus: 12, memGiB: 170, gpu: { type: 'A100-80GB', count: 1, memGiB: 80 }, usdPerHour: 5.07, spotPerHour: 1.74 },
  { provider: 'azure', name: 'NC24ads_A100_v4',     region: 'eastus',      vcpus: 24, memGiB: 220, gpu: { type: 'A100-80GB', count: 1, memGiB: 80 }, usdPerHour: 3.67, spotPerHour: 1.47 },
  { provider: 'aws',   name: 'p4de.24xlarge/8',     region: 'us-east-1',   vcpus: 12, memGiB: 145, gpu: { type: 'A100-80GB', count: 1, memGiB: 80 }, usdPerHour: 5.12, spotPerHour: 1.92 },
  { provider: 'ibm',   name: 'gx3-24x120x1a100',    region: 'us-south',    vcpus: 24, memGiB: 120, gpu: { type: 'A100-80GB', count: 1, memGiB: 80 }, usdPerHour: 4.39 },
  // ── L4 / A10G (cost-efficient inference) ──
  { provider: 'gcp',   name: 'g2-standard-8',        region: 'us-central1', vcpus: 8,  memGiB: 32,  gpu: { type: 'L4', count: 1, memGiB: 24 }, usdPerHour: 0.85, spotPerHour: 0.28 },
  { provider: 'aws',   name: 'g5.xlarge',            region: 'us-east-1',   vcpus: 4,  memGiB: 16,  gpu: { type: 'A10G', count: 1, memGiB: 24 }, usdPerHour: 1.006, spotPerHour: 0.40 },
  { provider: 'azure', name: 'NV36ads_A10_v5',       region: 'eastus',      vcpus: 36, memGiB: 440, gpu: { type: 'A10', count: 1, memGiB: 24 }, usdPerHour: 3.20 },
  // ── CPU-only (general compute) ──
  { provider: 'gcp',   name: 'n2-standard-8',        region: 'us-central1', vcpus: 8,  memGiB: 32, usdPerHour: 0.388, spotPerHour: 0.094 },
  { provider: 'aws',   name: 'm6i.2xlarge',          region: 'us-east-1',   vcpus: 8,  memGiB: 32, usdPerHour: 0.384, spotPerHour: 0.13 },
  { provider: 'azure', name: 'D8s_v5',               region: 'eastus',      vcpus: 8,  memGiB: 32, usdPerHour: 0.384, spotPerHour: 0.12 },
  { provider: 'ibm',   name: 'bx2-8x32',             region: 'us-south',    vcpus: 8,  memGiB: 32, usdPerHour: 0.376 },
  // ── local mesh (sovereign, $0 marginal) ──
  { provider: 'local', name: 'noetica-local',        region: 'on-device',   vcpus: 12, memGiB: 24, gpu: { type: 'metal', count: 1, memGiB: 24 }, usdPerHour: 0 },
]

export interface ComputeRequest {
  vcpus?: number
  memGiB?: number
  gpu?: { type?: string; count: number; minMemGiB?: number }
  hours: number
  spot?: boolean                     // accept interruptible (spot/preemptible) pricing
  providers?: CloudProvider[]        // restrict to a subset (e.g. only sovereign-approved clouds)
  excludeLocal?: boolean             // local has $0 cost; exclude it when the workload genuinely needs cloud
}

export interface BrokerQuote { sku: ComputeSku; effectivePerHour: number; totalUsd: number; spot: boolean }
export interface BrokerResult { best: BrokerQuote | null; ranked: BrokerQuote[]; considered: number; cheapestCloud: BrokerQuote | null }

const gpuMem = (s: ComputeSku) => s.gpu?.memGiB ?? 0

/** Does a SKU satisfy the resource floor of the request? */
function satisfies(s: ComputeSku, req: ComputeRequest): boolean {
  if (req.vcpus && s.vcpus < req.vcpus) return false
  if (req.memGiB && s.memGiB < req.memGiB) return false
  if (req.gpu) {
    if (!s.gpu || s.gpu.count < req.gpu.count) return false
    if (req.gpu.type && !s.gpu.type.toLowerCase().includes(req.gpu.type.toLowerCase())) return false
    if (req.gpu.minMemGiB && gpuMem(s) < req.gpu.minMemGiB) return false
  }
  return true
}

/** Broker a compute workload to the cheapest satisfying provider. Ranks ALL satisfying SKUs by total cost. */
export function brokerCompute(req: ComputeRequest, catalog: ComputeSku[] = COMPUTE_CATALOG): BrokerResult {
  const hours = Math.max(0, req.hours || 0)
  const allow = req.providers ? new Set(req.providers) : null
  const quotes: BrokerQuote[] = catalog
    .filter((s) => (!allow || allow.has(s.provider)) && (!req.excludeLocal || s.provider !== 'local') && satisfies(s, req))
    .map((s) => {
      const useSpot = !!req.spot && s.spotPerHour != null
      const effectivePerHour = useSpot ? s.spotPerHour! : s.usdPerHour
      return { sku: s, effectivePerHour, totalUsd: Number((effectivePerHour * hours).toFixed(2)), spot: useSpot }
    })
    .sort((a, b) => a.totalUsd - b.totalUsd || a.effectivePerHour - b.effectivePerHour)
  return {
    best: quotes[0] ?? null,
    ranked: quotes,
    considered: quotes.length,
    cheapestCloud: quotes.find((q) => q.sku.provider !== 'local') ?? null,
  }
}

/** Savings of the cheapest option vs the most expensive satisfying one (broker value, %). */
export function brokerSavings(result: BrokerResult): { absUsd: number; pct: number } {
  if (result.ranked.length < 2) return { absUsd: 0, pct: 0 }
  const lo = result.ranked[0]!.totalUsd, hi = result.ranked[result.ranked.length - 1]!.totalUsd
  return { absUsd: Number((hi - lo).toFixed(2)), pct: hi > 0 ? Math.round(((hi - lo) / hi) * 100) : 0 }
}

// ── agentplane conformance ──────────────────────────────────────────────────────
// agentplane (SocioProphet/agentplane) is the placement+evidence control plane over a sovereign SSH fleet; its
// scheduler picks WHICH already-provisioned node runs a bundle, by capability+reachability, and leaves the cost
// `objective` an explicit stub. This broker is the COST layer that feeds it: pick the cheapest cloud GPU, and
// emit an agentplane-shaped PlacementDecision so the cheapest-cloud choice slots straight into agentplane's
// receipt/coherence pipeline (and could register the provisioned box as an executor in fleet/inventory.json).
export interface AgentplanePlacementDecision {
  apiVersion: 'agentplane.socioprophet.org/v0.1'
  kind: 'PlacementDecision'
  lane: 'staging' | 'prod'
  chosenExecutor: string | null      // provider:sku:region (becomes an executor name once provisioned)
  provider: CloudProvider | null
  effectiveBackend: 'cloud-gpu' | 'cloud-cpu' | 'lima-process' | 'local'
  caps: { gpu?: string; gpuCount?: number; vcpus?: number; memGiB?: number; kvm?: boolean }
  objective: { metric: 'usd-total'; value: number; perHour: number; spot: boolean }   // fills agentplane's stub
  rejected: Array<{ executor: string; reason: string }>
  emittedAt?: string
}

/** Render a broker result as an agentplane-conformant PlacementDecision (the cost `objective` agentplane stubs). */
export function toAgentplanePlacement(result: BrokerResult, opts: { lane?: 'staging' | 'prod' } = {}): AgentplanePlacementDecision {
  const b = result.best
  const sku = b?.sku
  const backend: AgentplanePlacementDecision['effectiveBackend'] = !sku ? 'lima-process'
    : sku.provider === 'local' ? 'local' : sku.gpu ? 'cloud-gpu' : 'cloud-cpu'
  return {
    apiVersion: 'agentplane.socioprophet.org/v0.1',
    kind: 'PlacementDecision',
    lane: opts.lane ?? 'staging',
    chosenExecutor: sku ? `${sku.provider}:${sku.name}:${sku.region}` : null,
    provider: sku?.provider ?? null,
    effectiveBackend: backend,
    caps: sku ? { gpu: sku.gpu?.type, gpuCount: sku.gpu?.count, vcpus: sku.vcpus, memGiB: sku.memGiB, kvm: sku.provider !== 'local' } : {},
    objective: { metric: 'usd-total', value: b?.totalUsd ?? 0, perHour: b?.effectivePerHour ?? 0, spot: b?.spot ?? false },
    rejected: result.ranked.slice(1).map((q) => ({ executor: `${q.sku.provider}:${q.sku.name}:${q.sku.region}`, reason: `dearer (+$${(q.totalUsd - (b?.totalUsd ?? 0)).toFixed(2)})` })),
  }
}
