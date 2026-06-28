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
// Western hyperscalers + Asian hyperscalers (Alibaba/Huawei) + NEOCLOUD GPU specialists + sovereign-friendly + local.
// The multi-polar cloud world is the whole case for a cross-vendor broker — incl. NON-NVIDIA silicon (Huawei Ascend).
export type CloudProvider =
  | 'gcp' | 'azure' | 'aws' | 'ibm' | 'oci' | 'hetzner'
  | 'coreweave' | 'lambda' | 'nebius' | 'crusoe'
  | 'alibaba' | 'huawei'
  | 'local'
export const NEOCLOUDS: CloudProvider[] = ['coreweave', 'lambda', 'nebius', 'crusoe']
export const ASIAN_CLOUDS: CloudProvider[] = ['alibaba', 'huawei']

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

// Cross-cloud compute/GPU catalogue — loaded from the CANONICAL contract (gpu-catalog.v1.json), the SINGLE source
// of truth shared with tritfabric's gpu_broker.py. Do not hand-edit rows here: edit
// prophet-core-contracts/contracts/gpu-catalog.v1.json and re-vendor the copy next to this file.
import gpuCatalog from './gpu-catalog.v1.json'
export const COMPUTE_CATALOG: ComputeSku[] = gpuCatalog.skus as ComputeSku[]

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

// ── commodity SERVICES broker ───────────────────────────────────────────────────
// brokerCompute handles compute/GPU. This layer brokers the rest of the cloud as commodities (object store, managed
// k8s, DNS, managed Postgres, load balancers, secrets) so the platform is vendor-AGNOSTIC: one abstract ServiceKind
// maps to every vendor's primitive, and we select the cheapest compliant vendor (price + data residency + policy).
// Powers the Cloud panel and the deployment-provider selection. "Cloud is commodity; we are the broker."
export type ServiceKind = 'object-store' | 'kubernetes' | 'dns' | 'postgres' | 'load-balancer' | 'secrets'
export type Residency = 'EU' | 'US' | 'AU' | 'UK' | 'CA'

export interface ServiceOffering {
  provider: CloudProvider
  kind: ServiceKind
  primitive: string          // the vendor's product name for this commodity
  unitPriceUsd: number       // illustrative list unit price (per GB-month or per hour, by kind)
  residency: Residency[]     // data-residency regions this offering can satisfy
}

export const SERVICE_CATALOG: ServiceOffering[] = [
  { provider: 'gcp', kind: 'object-store', primitive: 'Cloud Storage', unitPriceUsd: 0.020, residency: ['EU', 'US', 'AU', 'UK', 'CA'] },
  { provider: 'aws', kind: 'object-store', primitive: 'S3', unitPriceUsd: 0.023, residency: ['EU', 'US', 'AU', 'UK', 'CA'] },
  { provider: 'azure', kind: 'object-store', primitive: 'Blob Storage', unitPriceUsd: 0.018, residency: ['EU', 'US', 'AU', 'UK', 'CA'] },
  { provider: 'ibm', kind: 'object-store', primitive: 'Cloud Object Storage', unitPriceUsd: 0.022, residency: ['EU', 'US', 'CA'] },
  { provider: 'hetzner', kind: 'object-store', primitive: 'Object Storage', unitPriceUsd: 0.005, residency: ['EU'] },
  { provider: 'gcp', kind: 'kubernetes', primitive: 'GKE', unitPriceUsd: 0.10, residency: ['EU', 'US', 'AU', 'UK', 'CA'] },
  { provider: 'aws', kind: 'kubernetes', primitive: 'EKS', unitPriceUsd: 0.10, residency: ['EU', 'US', 'AU', 'UK', 'CA'] },
  { provider: 'azure', kind: 'kubernetes', primitive: 'AKS', unitPriceUsd: 0.0, residency: ['EU', 'US', 'AU', 'UK', 'CA'] },
  { provider: 'ibm', kind: 'kubernetes', primitive: 'IKS', unitPriceUsd: 0.10, residency: ['EU', 'US', 'CA'] },
  { provider: 'gcp', kind: 'postgres', primitive: 'Cloud SQL', unitPriceUsd: 0.041, residency: ['EU', 'US', 'AU'] },
  { provider: 'aws', kind: 'postgres', primitive: 'RDS', unitPriceUsd: 0.043, residency: ['EU', 'US', 'AU'] },
  { provider: 'azure', kind: 'postgres', primitive: 'Azure DB for PostgreSQL', unitPriceUsd: 0.040, residency: ['EU', 'US', 'AU'] },
  { provider: 'gcp', kind: 'dns', primitive: 'Cloud DNS', unitPriceUsd: 0.20, residency: ['EU', 'US', 'AU', 'UK', 'CA'] },
  { provider: 'aws', kind: 'dns', primitive: 'Route 53', unitPriceUsd: 0.50, residency: ['EU', 'US', 'AU', 'UK', 'CA'] },
  { provider: 'gcp', kind: 'load-balancer', primitive: 'Cloud Load Balancing', unitPriceUsd: 0.025, residency: ['EU', 'US', 'AU', 'UK', 'CA'] },
  { provider: 'aws', kind: 'load-balancer', primitive: 'ELB', unitPriceUsd: 0.0225, residency: ['EU', 'US', 'AU', 'UK', 'CA'] },
  { provider: 'azure', kind: 'secrets', primitive: 'Key Vault', unitPriceUsd: 0.03, residency: ['EU', 'US', 'AU', 'UK', 'CA'] },
  { provider: 'gcp', kind: 'secrets', primitive: 'Secret Manager', unitPriceUsd: 0.06, residency: ['EU', 'US', 'AU', 'UK', 'CA'] },
]

export interface ServiceRequirement { kind: ServiceKind; residency?: Residency; maxPriceUsd?: number; exclude?: CloudProvider[]; prefer?: CloudProvider[] }

/** The vendor's primitive name for an abstract commodity (object-store → S3 / GCS / Blob …). */
export function mapResource(kind: ServiceKind, provider: CloudProvider): string | null {
  return SERVICE_CATALOG.find((o) => o.kind === kind && o.provider === provider)?.primitive ?? null
}

/** Panel data: every vendor for a kind, cheapest first. */
export function compareServices(kind: ServiceKind): ServiceOffering[] {
  return SERVICE_CATALOG.filter((o) => o.kind === kind).slice().sort((a, b) => a.unitPriceUsd - b.unitPriceUsd)
}

/** Select the cheapest compliant vendor for a commodity service (residency/exclude/maxPrice/prefer aware). */
export function selectVendor(req: ServiceRequirement): { provider: CloudProvider; offering: ServiceOffering; reason: string } | null {
  let c = SERVICE_CATALOG.filter((o) => o.kind === req.kind)
  if (req.residency) c = c.filter((o) => o.residency.includes(req.residency!))
  if (req.exclude?.length) c = c.filter((o) => !req.exclude!.includes(o.provider))
  if (req.maxPriceUsd != null) c = c.filter((o) => o.unitPriceUsd <= req.maxPriceUsd!)
  if (!c.length) return null
  c.sort((a, b) => (Number(req.prefer?.includes(b.provider) ?? false) - Number(req.prefer?.includes(a.provider) ?? false)) || a.unitPriceUsd - b.unitPriceUsd)
  const offering = c[0]
  const bits = [`cheapest ${req.kind} @ $${offering.unitPriceUsd}`]
  if (req.residency) bits.push(`${req.residency} residency`)
  if (req.exclude?.length) bits.push(`excl ${req.exclude.join(',')}`)
  return { provider: offering.provider, offering, reason: bits.join(', ') }
}
