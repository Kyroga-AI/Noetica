/**
 * model-registry — the models the choir can serve, with ORIGIN (for regulated tiers) + representative capability
 * benchmarks (so we can show, side by side, what each choir class means vs the frontier).
 *
 * Benchmark scores are REPRESENTATIVE composites (0-100) on four axes from ~Jan-2026 public reporting — for ranking
 * + "% of frontier" framing, NOT exact leaderboard claims. Re-verify against live evals before quoting to a client.
 */
export type ModelOrigin = "US" | "EU" | "CN" | "frontier-api";
export type Quantization = "Q4_K_M" | "bf16" | "none";

export interface HardwareSpec {
  /** Total parameter count in billions (null = API-only, size unknown on-device). */
  parameterCount: number | null;
  /** Quantization format used for the RAM estimate. 'none' = API-only. */
  quantization: Quantization;
  /** Estimated RAM required to run at this quantization, GiB. null = API-only. */
  ramGb: number | null;
}

export interface ModelSpec {
  id: string;
  label: string;
  origin: ModelOrigin;
  openWeights: boolean;
  license: string;
  bench: { reasoning: number; coding: number; math: number; agentic: number };
  hw: HardwareSpec;
}

const m = (id: string, label: string, origin: ModelOrigin, openWeights: boolean, license: string, reasoning: number, coding: number, math: number, agentic: number): Omit<ModelSpec, "hw"> =>
  ({ id, label, origin, openWeights, license, bench: { reasoning, coding, math, agentic } });

const HW: Record<string, HardwareSpec> = {
  // ── frontier (API-only; no local RAM requirement) ──
  "claude-opus-4-8":               { parameterCount: null, quantization: "none", ramGb: null },
  "gpt-5.x":                       { parameterCount: null, quantization: "none", ramGb: null },
  "gemini-3.5":                    { parameterCount: null, quantization: "none", ramGb: null },
  // ── Western open weights ──
  "meta-llama/Llama-4-Maverick":   { parameterCount: 400,  quantization: "Q4_K_M", ramGb: 42  },  // MoE; ~17B active
  "meta-llama/Llama-3.3-70B":      { parameterCount: 70,   quantization: "Q4_K_M", ramGb: 43  },
  "mistralai/Mistral-Large-3":     { parameterCount: 123,  quantization: "Q4_K_M", ramGb: 72  },
  "google/gemma-3-27b":            { parameterCount: 27,   quantization: "Q4_K_M", ramGb: 17  },
  "microsoft/phi-4":               { parameterCount: 14,   quantization: "Q4_K_M", ramGb: 9   },
  "openai/gpt-oss-120b":           { parameterCount: 120,  quantization: "Q4_K_M", ramGb: 72  },
  "openai/gpt-oss-20b":            { parameterCount: 20,   quantization: "Q4_K_M", ramGb: 13  },
  // ── Chinese open weights ──
  "deepseek-ai/DeepSeek-R1":       { parameterCount: 671,  quantization: "Q4_K_M", ramGb: 400 },  // full MoE; distilled variants smaller
  "deepseek-ai/DeepSeek-V3":       { parameterCount: 671,  quantization: "Q4_K_M", ramGb: 400 },
  "Qwen/Qwen3-235B":               { parameterCount: 235,  quantization: "Q4_K_M", ramGb: 140 },  // MoE; ~22B active
  "Qwen/Qwen3-32B":                { parameterCount: 32,   quantization: "Q4_K_M", ramGb: 20  },
  "Qwen/Qwen3-14B":                { parameterCount: 14,   quantization: "Q4_K_M", ramGb: 9   },
  "zai-org/GLM-4.6":               { parameterCount: 32,   quantization: "Q4_K_M", ramGb: 20  },
  "moonshotai/Kimi-K2":            { parameterCount: 1000, quantization: "Q4_K_M", ramGb: 600 },  // MoE; ~32B active
};

const _defaultHw: HardwareSpec = { parameterCount: null, quantization: "none", ramGb: null };

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
].map((s) => ({ ...s, hw: HW[s.id] ?? _defaultHw }));

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

/**
 * Whether a model's Q4 RAM requirement fits in the available host RAM.
 * Uses a 0.75 headroom factor to leave room for the OS and other processes.
 * Returns false for API-only models (ramGb === null).
 */
export const ramFitForHost = (spec: ModelSpec, hostRamGb: number): boolean =>
  spec.hw.ramGb !== null && spec.hw.ramGb <= hostRamGb * 0.75;
