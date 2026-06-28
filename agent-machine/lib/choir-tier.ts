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
  dataEgress: "open" | "in-boundary";
  requireAudit: boolean;
}

/** US Gov: FedRAMP-authorized hyperscalers + local; US residency; sovereign open models only; no frontier egress. */
export const US_GOV: TierPolicy = {
  id: "us-gov", tier: "regulated", regimes: ["fedramp-high"],
  allowedProviders: ["aws", "azure", "gcp", "ibm", "oci", "local"],
  allowedRegionPrefixes: ["us-", "eastus", "us"],
  allowFrontierApi: false,
  approvedModels: ["Qwen/Qwen3-14B", "Qwen/Qwen3-32B", "deepseek-ai/DeepSeek-R1", "meta-llama/Llama-3.3-70B"],
  dataEgress: "in-boundary", requireAudit: true,
};

/** AU Gov: IRAP-assessed clouds with AU regions + local; PROTECTED; in-boundary; no frontier egress. */
export const AU_GOV: TierPolicy = {
  id: "au-gov", tier: "regulated", regimes: ["irap-protected"],
  allowedProviders: ["aws", "azure", "gcp", "local"],
  allowedRegionPrefixes: ["ap-southeast", "australia", "au"],
  allowFrontierApi: false,
  approvedModels: ["Qwen/Qwen3-14B", "Qwen/Qwen3-32B", "deepseek-ai/DeepSeek-R1"],
  dataEgress: "in-boundary", requireAudit: true,
};

/** Regulated finance: SOC 2 + APRA CPS 234; authorized clouds + local; audited; no frontier egress by default. */
export const FINANCE: TierPolicy = {
  id: "finance-regulated", tier: "regulated", regimes: ["soc2", "apra-cps234"],
  allowedProviders: ["aws", "azure", "gcp", "ibm", "oci", "local"],
  allowFrontierApi: false,
  approvedModels: ["Qwen/Qwen3-14B", "Qwen/Qwen3-32B", "deepseek-ai/DeepSeek-R1"],
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

/** Is a model permitted under the policy? */
export function gateModel(p: TierPolicy, model?: string): boolean {
  if (!p.approvedModels) return true;
  return !!model && p.approvedModels.includes(model);
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
