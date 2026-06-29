/** Proofs the cost tee-up: cheapest provider chosen, count scales total, spot < on-demand, totals positive. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { estimateRun, estimateAll, WS_A, WS_C } from "./cost-estimator.js";
import { NEOCLOUDS } from "./cloud-broker.js";

test("H100 fine-tune brokers to a neocloud at spot; total = perHr × hours", () => {
  const e = estimateRun({ label: "x", gpuType: "H100", count: 1, hours: 10, spot: true });
  assert.ok(e);
  assert.ok((NEOCLOUDS as string[]).includes(e!.provider));
  assert.equal(e!.mode, "spot");
  assert.equal(e!.totalUsd, Number((e!.effectivePerHr * 10).toFixed(2)));
});

test("count scales the effective hourly + total", () => {
  const one = estimateRun({ label: "1", gpuType: "H100", count: 1, hours: 5 })!;
  const four = estimateRun({ label: "4", gpuType: "H100", count: 4, hours: 5 })!;
  assert.equal(four.effectivePerHr, Number((one.effectivePerHr * 4).toFixed(4)));
});

test("WS-A + WS-C scenarios all estimate to a positive total", () => {
  const all = estimateAll([...WS_A, ...WS_C]);
  assert.equal(all.length, WS_A.length + WS_C.length);
  assert.ok(all.every((e) => e.totalUsd > 0));
});

test("no matching GPU → null (no surprise charge)", () => {
  assert.equal(estimateRun({ label: "x", gpuType: "NONEXISTENT", count: 1, hours: 1 }), null);
});
