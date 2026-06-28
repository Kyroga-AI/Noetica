/** Proofs for the two-class choir: OPEN routes anywhere/cheapest; REGULATED (US Gov/AU Gov/finance) enforces
 *  authorized-providers + residency + no-frontier-egress + approved-models. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { routeUnderTier, gateModel, OPEN, US_GOV, AU_GOV, FINANCE } from "./choir-tier.js";
import { NEOCLOUDS } from "./cloud-broker.js";

test("OPEN tier: frontier allowed, cheapest H100 wins (neocloud), no model gate", () => {
  const d = routeUnderTier(OPEN, { gpu: { type: "H100", count: 1 }, hours: 10, excludeLocal: true, frontierApi: true });
  assert.ok(d.allowed);
  assert.ok((NEOCLOUDS as string[]).includes(d.provider!), d.provider);
  assert.equal(d.audit, false);
});

test("US Gov: frontier-API egress is DENIED", () => {
  const d = routeUnderTier(US_GOV, { model: "Qwen/Qwen3-14B", frontierApi: true });
  assert.equal(d.allowed, false);
  assert.match(d.reason, /frontier/);
});

test("US Gov: a non-approved model is DENIED", () => {
  const d = routeUnderTier(US_GOV, { model: "gpt-4o", gpu: { type: "A100", count: 1 }, hours: 10 });
  assert.equal(d.allowed, false);
  assert.match(d.reason, /approved/);
});

test("US Gov: approved model brokers ONLY to FedRAMP providers in US regions (no neocloud/Asian)", () => {
  const d = routeUnderTier(US_GOV, { model: "Qwen/Qwen3-14B", gpu: { type: "A100", count: 1 }, hours: 10 });
  assert.ok(d.allowed, d.reason);
  assert.ok(["aws", "azure", "gcp", "ibm", "oci"].includes(d.provider!), d.provider);
  assert.ok(!(NEOCLOUDS as string[]).includes(d.provider!));
  assert.ok(d.provider !== "alibaba" && d.provider !== "huawei", "no non-FedRAMP cloud");
  assert.equal(d.audit, true);
});

test("AU Gov: no AU cloud region in catalog → lands on local (in-boundary); never a foreign cloud", () => {
  const d = routeUnderTier(AU_GOV, { model: "Qwen/Qwen3-14B", gpu: { count: 1 }, hours: 10 });
  assert.ok(d.allowed, d.reason);
  assert.equal(d.provider, "local");
});

test("Finance: approved model on an authorized cloud, audited; frontier denied", () => {
  assert.equal(routeUnderTier(FINANCE, { model: "Qwen/Qwen3-14B", frontierApi: true }).allowed, false);
  const d = routeUnderTier(FINANCE, { model: "Qwen/Qwen3-14B", gpu: { type: "A100", count: 1 }, hours: 10 });
  assert.ok(d.allowed && d.audit);
});

test("gateModel: open allows all; regulated allowlists", () => {
  assert.equal(gateModel(OPEN, "anything"), true);
  assert.equal(gateModel(US_GOV, "Qwen/Qwen3-14B"), true);
  assert.equal(gateModel(US_GOV, "claude-opus"), false);
});
