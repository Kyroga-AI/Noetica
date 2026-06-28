/**
 * compliance-report — turns choir-tier enforcement + routing decisions into an AUDITOR-GRADE attestation. This is the
 * "printable governance" gap vs IBM watsonx.governance: map our runtime controls (no-frontier-egress, in-boundary
 * data, authorized providers, residency, approved models, audit) onto recognised control frameworks (FedRAMP/NIST,
 * IRAP, SOC 2, APRA CPS 234, EU AI Act) and emit a report. Pure derivation from the policy + the decisions — no infra.
 */
import { type TierPolicy, type TierDecision, type Regime } from "./choir-tier.js";

export type ControlStatus = "satisfied" | "gap" | "not-applicable";
export interface Control { id: string; name: string; status: ControlStatus; evidence: string }
export interface ComplianceReport {
  regime: Regime;
  policyId: string;
  attestation: "compliant" | "non-compliant";
  controls: Control[];
  decisionCount: number;
  generatedBasis: string; // caller stamps the timestamp (kept out of logic for determinism)
}

// Recognised-framework control IDs per regime → which runtime property proves them.
type Key = "egress" | "boundary" | "providers" | "residency" | "models" | "audit";
const FRAMEWORK: Record<Regime, Array<{ id: string; name: string; key: Key }>> = {
  "fedramp-high": [
    { id: "SA-9", name: "External system services (no uncontrolled frontier egress)", key: "egress" },
    { id: "SC-7", name: "Boundary protection (data stays in-boundary)", key: "boundary" },
    { id: "CM-7", name: "Least functionality (approved model allowlist)", key: "models" },
    { id: "AC-4", name: "Information flow enforcement (authorized providers)", key: "providers" },
    { id: "AU-2", name: "Audit events", key: "audit" },
  ],
  "fedramp-moderate": [
    { id: "SA-9", name: "External system services", key: "egress" },
    { id: "SC-7", name: "Boundary protection", key: "boundary" },
    { id: "AU-2", name: "Audit events", key: "audit" },
  ],
  "irap-protected": [
    { id: "ISM-0520", name: "Offshore/foreign access prevented (data residency)", key: "residency" },
    { id: "ISM-1395", name: "Gateway egress control", key: "egress" },
    { id: "ISM-0407", name: "Authorized service providers", key: "providers" },
    { id: "ISM-0585", name: "Event logging", key: "audit" },
  ],
  soc2: [
    { id: "CC6.1", name: "Logical access / egress restriction", key: "egress" },
    { id: "CC6.7", name: "Data confined to boundary", key: "boundary" },
    { id: "CC7.2", name: "Monitoring / audit", key: "audit" },
  ],
  "apra-cps234": [
    { id: "CPS234-15", name: "Information asset controls (in-boundary)", key: "boundary" },
    { id: "CPS234-21", name: "Third-party / provider assurance", key: "providers" },
    { id: "CPS234-27", name: "Logging & response", key: "audit" },
  ],
  "eu-ai-act": [
    { id: "Art.10", name: "Data governance (in-boundary, approved sources)", key: "boundary" },
    { id: "Art.12", name: "Record-keeping (audit trail)", key: "audit" },
    { id: "Art.13", name: "Transparency (approved, known models)", key: "models" },
  ],
};

function evaluate(key: Key, policy: TierPolicy, decisions: TierDecision[]): { status: ControlStatus; evidence: string } {
  const allowed = decisions.filter((d) => d.allowed);
  switch (key) {
    case "egress":
      return policy.allowFrontierApi
        ? { status: "gap", evidence: "frontier-API egress is permitted in this tier" }
        : { status: "satisfied", evidence: "frontier-API egress denied by policy" };
    case "boundary":
      return policy.dataEgress === "in-boundary"
        ? { status: "satisfied", evidence: "data egress = in-boundary (vault-sealed)" }
        : { status: "gap", evidence: "data egress is open" };
    case "providers":
      return policy.allowedProviders
        ? { status: "satisfied", evidence: `routed only to authorized providers: ${policy.allowedProviders.join(", ")}` }
        : { status: "gap", evidence: "no provider allowlist" };
    case "residency":
      return policy.allowedRegionPrefixes
        ? { status: "satisfied", evidence: `residency enforced to: ${policy.allowedRegionPrefixes.join(", ")} (+ on-device)` }
        : { status: "gap", evidence: "no residency constraint" };
    case "models":
      return policy.approvedModels
        ? { status: "satisfied", evidence: `approved models only (${policy.approvedModels.length} on allowlist)` }
        : { status: "gap", evidence: "no model allowlist" };
    case "audit":
      return policy.requireAudit
        ? { status: "satisfied", evidence: `audit required; ${allowed.length} routing decision(s) recorded` }
        : { status: "gap", evidence: "audit not required" };
  }
}

/** Build the report for a regime from the tier policy + the routing decisions that were actually made. */
export function buildComplianceReport(regime: Regime, policy: TierPolicy, decisions: TierDecision[], generatedBasis = ""): ComplianceReport {
  const controls: Control[] = (FRAMEWORK[regime] ?? []).map((c) => {
    const r = evaluate(c.key, policy, decisions);
    return { id: c.id, name: c.name, status: r.status, evidence: r.evidence };
  });
  const anyDenied = decisions.some((d) => !d.allowed);
  const anyGap = controls.some((c) => c.status === "gap");
  return {
    regime, policyId: policy.id,
    attestation: anyGap || anyDenied ? "non-compliant" : "compliant",
    controls, decisionCount: decisions.length, generatedBasis,
  };
}

/** Render the report as auditor-readable markdown. */
export function renderReportMarkdown(r: ComplianceReport): string {
  const head = `# Compliance attestation — ${r.regime.toUpperCase()}\n\n- Policy: \`${r.policyId}\`\n- Attestation: **${r.attestation}**\n- Routing decisions evaluated: ${r.decisionCount}${r.generatedBasis ? `\n- Generated: ${r.generatedBasis}` : ""}\n\n| Control | Name | Status | Evidence |\n|---|---|---|---|`;
  const rows = r.controls.map((c) => `| ${c.id} | ${c.name} | ${c.status === "satisfied" ? "✓" : c.status === "gap" ? "✗ GAP" : "n/a"} | ${c.evidence} |`).join("\n");
  return `${head}\n${rows}\n`;
}
