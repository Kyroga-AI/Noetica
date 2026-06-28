/**
 * choir-tier — two choir CLASSES with enforced compliance, so the same mesh serves both a cost-optimized OPEN tier
 * and a REGULATED tier for US Gov (FedRAMP), AU Gov (IRAP/PROTECTED), and regulated finance (SOC 2 / APRA CPS 234).
 *
 *   OPEN tier      → cheapest anywhere: frontier APIs + neoclouds + Asian clouds + local; data may egress.
 *   REGULATED tier → authorized providers only, in-jurisdiction residency, NO frontier-API egress, approved models,
 *                    data stays in-boundary (vault-sealed), full audit. Inference is brokered ONLY across the
 *                    compliant supply.
 *
 * Flexibility is the point: pick a tier per workload/tenant; the broker + policy do the rest. Pure policy — no infra.
 */
import { brokerCompute, type CloudProvider, type ComputeRequest, type ComputeSku } from "./cloud-broker.js";
import { originOf, type ModelOrigin } from "./model-registry.js";

export type ChoirTier = "open" | "regulated";
export type Regime = "fedramp-high" | "fedramp-moderate" | "irap-protected" | "soc2" | "apra-cps234" | "eu-ai-act";

export interface TierPolicy {
  id: string;
  tier: ChoirTier;
  regimes: Regime[];
  allowedProviders?: CloudProvider[]; // undefined = all (open). regulated = authorized set only.
  allowedRegionPrefixes?: string[];   // residency: SKU.region must start with one of these (regulated)
  allowFrontierApi: boolean;          // regulated → false: no egress to external frontier APIs
  approvedModels?: string[];          // regulated → allowlist (sovereign open models run in-boundary)
  allowedOrigins?: ModelOrigin[];     // regulated → origin gate (gov defaults to Western/allied: US/EU)
  dataEgress: "open" | "in-boundary";
  requireAudit: boolean;
}

/** US Gov: FedRAMP clouds + local; US residency; WESTERN/allied-origin open models only; no frontier egress. */
export const US_GOV: TierPolicy = {
  id: "us-gov", tier: "regulated", regimes: ["fedramp-high"],
  allowedProviders: ["aws", "azure", "gcp", "ibm", "oci", "local"],
  allowedRegionPrefixes: ["us-", "eastus", "us"],
  allowFrontierApi: false,
  allowedOrigins: ["US", "EU"],
  approvedModels: ["meta-llama/Llama-4-Maverick", "meta-llama/Llama-3.3-70B", "mistralai/Mistral-Large-3", "google/gemma-3-27b", "microsoft/phi-4"],
  dataEgress: "in-boundary", requireAudit: true,
};

/** AU Gov: IRAP-assessed clouds with AU regions + local; PROTECTED; Western/allied origin; no frontier egress. */
export const AU_GOV: TierPolicy = {
  id: "au-gov", tier: "regulated", regimes: ["irap-protected"],
  allowedProviders: ["aws", "azure", "gcp", "local"],
  allowedRegionPrefixes: ["ap-southeast", "australia", "au"],
  allowFrontierApi: false,
  allowedOrigins: ["US", "EU"],
  approvedModels: ["meta-llama/Llama-4-Maverick", "meta-llama/Llama-3.3-70B", "mistralai/Mistral-Large-3", "google/gemma-3-27b", "microsoft/phi-4"],
  dataEgress: "in-boundary", requireAudit: true,
};

/** Regulated finance: SOC 2 + APRA CPS 234; audited; Western default + Chinese-open AFTER REVIEW (best perf/cost). */
export const FINANCE: TierPolicy = {
  id: "finance-regulated", tier: "regulated", regimes: ["soc2", "apra-cps234"],
  allowedProviders: ["aws", "azure", "gcp", "ibm", "oci", "local"],
  allowFrontierApi: false,
  allowedOrigins: ["US", "EU", "CN"],
  approvedModels: ["meta-llama/Llama-4-Maverick", "mistralai/Mistral-Large-3", "deepseek-ai/DeepSeek-R1", "Qwen/Qwen3-32B"],
  dataEgress: "in-boundary", requireAudit: true,
};

/** Open tier: everything, cheapest wins. */
export const OPEN: TierPolicy = {
  id: "open", tier: "open", regimes: [],
  allowFrontierApi: true, dataEgress: "open", requireAudit: false,
};

export const TIERS: Record<string, TierPolicy> = { open: OPEN, "us-gov": US_GOV, "au-gov": AU_GOV, "finance-regulated": FINANCE };

export interface InferenceRequest extends Omit<ComputeRequest, "hours"> {
  hours?: number;        // optional: a request can be denied (frontier/model) before any brokering
  model?: string;
  frontierApi?: boolean; // the request wants to call an external frontier API (Claude/GPT)
}
export interface TierDecision {
  allowed: boolean;
  reason: string;
  tier: ChoirTier;
  regimes: Regime[];
  provider?: CloudProvider;
  sku?: ComputeSku;
  estUsdPerHour?: number;
  audit: boolean;
}

const deny = (p: TierPolicy, reason: string): TierDecision => ({ allowed: false, reason, tier: p.tier, regimes: p.regimes, audit: p.requireAudit });

/** Is a model permitted under the policy? Gates on BOTH the allowlist and the model's ORIGIN (gov → Western/allied). */
export function gateModel(p: TierPolicy, model?: string): boolean {
  if (!p.approvedModels && !p.allowedOrigins) return true;
  if (!model) return false;
  if (p.approvedModels && !p.approvedModels.includes(model)) return false;
  if (p.allowedOrigins) { const o = originOf(model); if (!o || !p.allowedOrigins.includes(o)) return false; }
  return true;
}

/** Enforce the tier on an inference/training request: gate egress + model, then broker ONLY the compliant supply. */
export function routeUnderTier(p: TierPolicy, req: InferenceRequest): TierDecision {
  if (req.frontierApi && !p.allowFrontierApi) return deny(p, "frontier-API egress not permitted in this tier");
  if (!gateModel(p, req.model)) return deny(p, `model '${req.model ?? "(none)"}' not on the approved list for ${p.id}`);

  // Restrict the broker to authorized providers, then (regulated) to in-jurisdiction regions.
  const result = brokerCompute({ ...req, hours: req.hours ?? 0, providers: p.allowedProviders ?? req.providers });
  let ranked = result.ranked;
  // local (on-device) is in-boundary by definition → always residency-compliant.
  if (p.allowedRegionPrefixes) ranked = ranked.filter((q) => q.sku.provider === "local" || p.allowedRegionPrefixes!.some((pre) => q.sku.region.startsWith(pre)));
  const best = ranked[0];
  if (!best) return deny(p, "no compliant provider/region satisfies the request in this tier");

  return {
    allowed: true,
    reason: `compliant: ${p.regimes.join("+") || "open"} on ${best.sku.provider} (${best.sku.region})`,
    tier: p.tier, regimes: p.regimes,
    provider: best.sku.provider, sku: best.sku, estUsdPerHour: best.effectivePerHour,
    audit: p.requireAudit,
  };
}
