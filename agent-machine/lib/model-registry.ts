/**
 * model-registry — the models the choir can serve, with ORIGIN (for regulated tiers) + representative capability
 * benchmarks (so we can show, side by side, what each choir class means vs the frontier).
 *
 * Benchmark scores are REPRESENTATIVE composites (0-100) on four axes from ~Jan-2026 public reporting — for ranking
 * + "% of frontier" framing, NOT exact leaderboard claims. Re-verify against live evals before quoting to a client.
 */
export type ModelOrigin = "US" | "EU" | "CN" | "frontier-api";

export interface ModelSpec {
  id: string;
  label: string;
  origin: ModelOrigin;
  openWeights: boolean;
  license: string;
  bench: { reasoning: number; coding: number; math: number; agentic: number };
}

const m = (id: string, label: string, origin: ModelOrigin, openWeights: boolean, license: string, reasoning: number, coding: number, math: number, agentic: number): ModelSpec =>
  ({ id, label, origin, openWeights, license, bench: { reasoning, coding, math, agentic } });

export const MODELS: ModelSpec[] = [
  // ── frontier (API only — OPEN tier) ──
  m("claude-opus-4-8", "Claude Opus 4.8", "frontier-api", false, "proprietary", 93, 92, 90, 93),
  m("gpt-5.x", "GPT-5.x", "frontier-api", false, "proprietary", 92, 90, 91, 90),
  m("gemini-3.5", "Gemini 3.5", "frontier-api", false, "proprietary", 90, 88, 90, 89),
  // ── Western / allied open (gov-safe by default) ──
  m("meta-llama/Llama-4-Maverick", "Llama 4 Maverick", "US", true, "Llama Community", 84, 82, 80, 83),
  m("meta-llama/Llama-3.3-70B", "Llama 3.3 70B", "US", true, "Llama Community", 80, 78, 76, 79),
  m("mistralai/Mistral-Large-3", "Mistral Large 3", "EU", true, "Mistral/Apache", 82, 80, 78, 80),
  m("google/gemma-3-27b", "Gemma 3 27B", "US", true, "Gemma", 78, 74, 75, 74),
  m("microsoft/phi-4", "Phi-4 (14B)", "US", true, "MIT", 76, 72, 78, 70),
  m("openai/gpt-oss-120b", "GPT-OSS 120B", "US", true, "Apache-2.0", 86, 80, 88, 82),
  m("openai/gpt-oss-20b", "GPT-OSS 20B", "US", true, "Apache-2.0", 78, 72, 80, 74),
  // ── Chinese open (best perf/cost; OPEN + commercial; gov only after review) ──
  m("deepseek-ai/DeepSeek-R1", "DeepSeek-R1", "CN", true, "MIT", 90, 86, 92, 86),
  m("deepseek-ai/DeepSeek-V3", "DeepSeek-V3", "CN", true, "MIT", 86, 85, 84, 85),
  m("Qwen/Qwen3-235B", "Qwen3-235B", "CN", true, "Apache-2.0", 88, 86, 87, 86),
  m("Qwen/Qwen3-32B", "Qwen3-32B", "CN", true, "Apache-2.0", 82, 80, 80, 80),
  m("Qwen/Qwen3-14B", "Qwen3-14B", "CN", true, "Apache-2.0", 76, 74, 74, 73),
  m("zai-org/GLM-4.6", "GLM-4.6", "CN", true, "MIT", 84, 86, 80, 85),
  m("moonshotai/Kimi-K2", "Kimi K2", "CN", true, "Modified-MIT", 85, 84, 82, 88),
];

const BY_ID = new Map(MODELS.map((x) => [x.id, x]));
export const getModel = (id: string): ModelSpec | undefined => BY_ID.get(id);
export const originOf = (id: string): ModelOrigin | undefined => BY_ID.get(id)?.origin;
export const composite = (s: ModelSpec): number =>
  Math.round((s.bench.reasoning + s.bench.coding + s.bench.math + s.bench.agentic) / 4);

/** The frontier reference (best frontier-api composite) — the bar everything is measured against. */
export const FRONTIER_REF = Math.max(...MODELS.filter((x) => x.origin === "frontier-api").map(composite));

/** % of the frontier bar a given model reaches. */
export const pctOfFrontier = (id: string): number => {
  const s = BY_ID.get(id);
  return s ? Math.round((composite(s) / FRONTIER_REF) * 100) : 0;
};
