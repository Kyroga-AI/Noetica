/**
 * cost-estimator — itemized run-cost tee-up for the prove-on-metal phases (WS-A fine-tuning, WS-C the cloud-mesh
 * proof). Computes off the CANONICAL gpu-catalog via the broker, so estimates track the single source of truth.
 * Multi-GPU is priced as count × single-GPU best (catalog SKUs are per-GPU). Spot used where requested.
 */
import { brokerCompute, brokerSavings, type CloudProvider } from "./cloud-broker.js";

export interface RunSpec { label: string; gpuType: string; count: number; hours: number; spot?: boolean; providers?: CloudProvider[] }
export interface RunEstimate {
  label: string; gpuType: string; count: number; hours: number; mode: "spot" | "on-demand";
  provider: CloudProvider; perGpuHr: number; effectivePerHr: number; totalUsd: number; savingsPct: number;
}

/** Estimate one run: broker the cheapest single GPU, scale by count, total over hours. */
export function estimateRun(s: RunSpec): RunEstimate | null {
  const r = brokerCompute({ gpu: { type: s.gpuType, count: 1 }, hours: s.hours, spot: s.spot, providers: s.providers });
  const best = r.best;
  if (!best) return null;
  const effectivePerHr = Number((best.effectivePerHour * s.count).toFixed(4));
  return {
    label: s.label, gpuType: s.gpuType, count: s.count, hours: s.hours,
    mode: best.spot ? "spot" : "on-demand", provider: best.sku.provider,
    perGpuHr: best.effectivePerHour, effectivePerHr,
    totalUsd: Number((effectivePerHr * s.hours).toFixed(2)),
    savingsPct: brokerSavings(r).pct,
  };
}

// Phase-1 scenarios (realistic defaults; tweak per real run).
export const WS_A: RunSpec[] = [
  { label: "WS-A · LoRA fine-tune Qwen3-32B (1×H100, 12h, spot)", gpuType: "H100", count: 1, hours: 12, spot: true },
  { label: "WS-A · LoRA fine-tune Llama-3.3-70B (2×H100, 18h)", gpuType: "H100", count: 2, hours: 18 },
  { label: "WS-A · Ray Serve choir baseline (1×L4, 730h/mo)", gpuType: "L4", count: 1, hours: 730 },
];
export const WS_C: RunSpec[] = [
  { label: "WS-C · beats-frontier proof burst (1×H100, 6h, spot)", gpuType: "H100", count: 1, hours: 6, spot: true },
  { label: "WS-C · live client demo cluster (4×H100, 3h)", gpuType: "H100", count: 4, hours: 3 },
];

export function estimateAll(specs: RunSpec[]): RunEstimate[] {
  return specs.map(estimateRun).filter((e): e is RunEstimate => !!e);
}

/** Markdown tee-up table + total. */
export function renderEstimate(title: string, specs: RunSpec[]): string {
  const rows = estimateAll(specs);
  const total = rows.reduce((a, r) => a + r.totalUsd, 0);
  let out = `# ${title}\n\n| Run | GPU×N | Hours | Mode | Cheapest provider | $/hr (eff) | Total | Broker saving |\n|---|---|---|---|---|---|---|---|\n`;
  for (const r of rows) out += `| ${r.label} | ${r.gpuType}×${r.count} | ${r.hours} | ${r.mode} | ${r.provider} | $${r.effectivePerHr} | **$${r.totalUsd}** | ${r.savingsPct}% |\n`;
  out += `\n**Total: $${total.toFixed(2)}** (brokered to cheapest compliant supply; spot where noted).\n`;
  return out;
}
