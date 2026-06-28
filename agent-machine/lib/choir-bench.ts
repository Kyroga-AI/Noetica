/**
 * choir-bench — demonstrates, side by side, what each choir CLASS means in capability terms: the component models a
 * tier may use, their per-axis benchmarks, composite, and % of the frontier bar. Answers "does our work still match
 * the frontier?" per tier. Pure derivation from the model-registry (representative ~Jan-2026 benchmarks).
 */
import { MODELS, getModel, composite, pctOfFrontier, type ModelSpec } from "./model-registry.js";
import { type TierPolicy } from "./choir-tier.js";

export interface ModelRow { id: string; label: string; origin: string; composite: number; pctOfFrontier: number; reasoning: number; coding: number; math: number; agentic: number }
export interface TierCapability { tierId: string; best: ModelRow; pctOfFrontier: number; roster: ModelRow[] }

const row = (s: ModelSpec): ModelRow => ({
  id: s.id, label: s.label, origin: s.origin, composite: composite(s), pctOfFrontier: pctOfFrontier(s.id),
  reasoning: s.bench.reasoning, coding: s.bench.coding, math: s.bench.math, agentic: s.bench.agentic,
});

/** The models a tier may field. OPEN = all OPEN-WEIGHT models (closed frontier APIs are the bar, never fielded). */
function rosterOf(p: TierPolicy): ModelSpec[] {
  if (!p.approvedModels) return MODELS.filter((x) => x.openWeights); // OPEN: open weights only
  return p.approvedModels.map(getModel).filter((x): x is ModelSpec => !!x);
}

/** Capability of a tier: its component roster + the best it can field + % of frontier that represents. */
export function tierCapability(p: TierPolicy): TierCapability {
  const roster = rosterOf(p).map(row).sort((a, b) => b.composite - a.composite);
  const best = roster[0];
  return { tierId: p.id, best, pctOfFrontier: best?.pctOfFrontier ?? 0, roster };
}

export function compareTiers(policies: TierPolicy[]): TierCapability[] {
  return policies.map(tierCapability);
}

/** Side-by-side markdown: per tier, the best model + % of frontier, then the full component roster with axes. */
export function renderMatrix(policies: TierPolicy[]): string {
  const caps = compareTiers(policies);
  let out = "# Choir capability vs frontier (representative ~Jan-2026 benchmarks)\n\n";
  out += "| Choir class | Best available model | Origin | Composite | % of frontier |\n|---|---|---|---|---|\n";
  for (const c of caps) out += `| ${c.tierId} | ${c.best.label} | ${c.best.origin} | ${c.best.composite} | **${c.pctOfFrontier}%** |\n`;
  for (const c of caps) {
    out += `\n## ${c.tierId} — component models\n\n| Model | Origin | Reasoning | Coding | Math | Agentic | Composite | %front |\n|---|---|---|---|---|---|---|---|\n`;
    for (const r of c.roster) out += `| ${r.label} | ${r.origin} | ${r.reasoning} | ${r.coding} | ${r.math} | ${r.agentic} | ${r.composite} | ${r.pctOfFrontier}% |\n`;
  }
  return out;
}
