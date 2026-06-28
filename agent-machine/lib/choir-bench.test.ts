/** Proofs the capability comparison: OPEN = frontier (100%), regulated tiers field a quantified % of frontier. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { tierCapability, compareTiers, renderMatrix } from "./choir-bench.js";
import { OPEN, US_GOV, AU_GOV, FINANCE } from "./choir-tier.js";

test("OPEN tier fields the best OPEN-WEIGHT model (NOT a closed frontier API)", () => {
  const c = tierCapability(OPEN);
  assert.notEqual(c.best.origin, "frontier-api", "closed APIs are the bar, never fielded");
  assert.ok(c.roster.every((r) => r.origin !== "frontier-api"), "no closed models in the open-weights roster");
  assert.ok(c.pctOfFrontier >= 90 && c.pctOfFrontier <= 100, `${c.pctOfFrontier}% of frontier on open weights`);
});

test("regulated gov tiers field Western-origin open models at a quantified % of frontier", () => {
  const us = tierCapability(US_GOV);
  assert.ok(us.best.origin === "US" || us.best.origin === "EU", us.best.origin);
  assert.ok(us.pctOfFrontier >= 80 && us.pctOfFrontier < 100, `US gov ${us.pctOfFrontier}%`);
  assert.ok(us.roster.every((r) => r.origin === "US" || r.origin === "EU"), "no CN/frontier in gov roster");
});

test("finance (CN-after-review) reaches higher % than Western-only gov", () => {
  assert.ok(tierCapability(FINANCE).pctOfFrontier >= tierCapability(US_GOV).pctOfFrontier);
});

test("matrix renders all classes side by side", () => {
  const md = renderMatrix([OPEN, US_GOV, AU_GOV, FINANCE]);
  assert.match(md, /% of frontier/);
  assert.match(md, /us-gov/);
  assert.match(md, /component models/);
  assert.equal(compareTiers([OPEN, US_GOV, AU_GOV, FINANCE]).length, 4);
});
