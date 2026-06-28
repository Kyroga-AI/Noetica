/** Proofs the regulated tier produces an auditor-grade attestation, and the open tier honestly reports gaps. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildComplianceReport, renderReportMarkdown } from "./compliance-report.js";
import { routeUnderTier, US_GOV, AU_GOV, FINANCE, OPEN } from "./choir-tier.js";

test("US Gov routing → FedRAMP attestation is COMPLIANT with all controls satisfied", () => {
  const d = routeUnderTier(US_GOV, { model: "Qwen/Qwen3-14B", gpu: { type: "A100", count: 1 }, hours: 10 });
  const r = buildComplianceReport("fedramp-high", US_GOV, [d]);
  assert.equal(r.attestation, "compliant");
  assert.ok(r.controls.every((c) => c.status === "satisfied"));
  assert.ok(r.controls.some((c) => c.id === "SA-9" && /egress denied/.test(c.evidence)));
});

test("AU Gov → IRAP attestation enforces residency + egress", () => {
  const d = routeUnderTier(AU_GOV, { model: "Qwen/Qwen3-14B", gpu: { count: 1 }, hours: 5 });
  const r = buildComplianceReport("irap-protected", AU_GOV, [d]);
  assert.equal(r.attestation, "compliant");
  assert.ok(r.controls.some((c) => c.id === "ISM-0520" && c.status === "satisfied"));
});

test("Finance → SOC 2 attestation compliant + audited", () => {
  const d = routeUnderTier(FINANCE, { model: "Qwen/Qwen3-14B", gpu: { type: "A100", count: 1 }, hours: 8 });
  const r = buildComplianceReport("soc2", FINANCE, [d]);
  assert.equal(r.attestation, "compliant");
  assert.ok(r.controls.find((c) => c.id === "CC7.2")?.status === "satisfied");
});

test("OPEN tier honestly reports GAPS against a regime (it's not designed for it)", () => {
  const r = buildComplianceReport("fedramp-high", OPEN, []);
  assert.equal(r.attestation, "non-compliant");
  assert.ok(r.controls.some((c) => c.status === "gap"));
});

test("markdown render is auditor-readable", () => {
  const d = routeUnderTier(US_GOV, { model: "Qwen/Qwen3-14B", gpu: { type: "A100", count: 1 }, hours: 10 });
  const md = renderReportMarkdown(buildComplianceReport("fedramp-high", US_GOV, [d], "2026-06-28"));
  assert.match(md, /Compliance attestation — FEDRAMP-HIGH/);
  assert.match(md, /\*\*compliant\*\*/);
  assert.match(md, /SA-9/);
});
