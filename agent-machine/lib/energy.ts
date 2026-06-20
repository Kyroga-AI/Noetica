/**
 * energy — per-dispatch energy accounting (Voice Concierge Spec §9). The honest claim,
 * not the marketing one. We measure the DEVICE side (T1) and derive the CLOUD baseline
 * (T2), and report the real structure rather than a flattering aggregate:
 *
 *   • recall / extract (a READ — a lookup, no inference) ≈ idle draw × ~0.25s ≈ 2 J
 *   • generation on the local CPU ≈ 22.5 W × ~150 s ≈ 3380 J — MORE than a cloud GPU
 *     would spend per token, because our CPU is less efficient per generation.
 *
 * The win is architectural: the logic-first front makes most answers near-zero-energy
 * reads, and crystallization AMORTIZES the rare generation (generate once → recall free
 * forever). So the system wins at the WORKLOAD level (reuse-weighted), not by pretending
 * a CPU out-efficiencies a datacenter GPU per generation. Data also never leaves (T1
 * sovereignty), which is a separate, stronger claim than joules.
 *
 * Claim-mode discipline (manuscript §1.8, §12): DEVICE is T1 — measured watts (battery
 * controller, ioreg) × measured latency. CLOUD is T2 — a derived estimate of an
 * unobserved path, with explicit, auditable coefficients below. Never report the cloud
 * baseline as observed.
 */

// ── MEASURED on this hardware (T1), 2026-06, via AppleSmartBattery instantaneous draw ──
const DEVICE_IDLE_W = 8.8   // quiescent system draw
const DEVICE_GEN_W = 22.5   // under sustained qwen2.5:7b CPU inference

// ── CLOUD BASELINE (T2 — derived, auditable). A frontier datacenter model answering the
// SAME query. 0.3 Wh/query is a commonly-cited median for a large hosted model; PUE 1.2
// is datacenter overhead. Frontier-LARGE models run ~3–10× higher — we use the
// conservative median and STATE it, so the claim is honest and the coefficient is one
// line to revise when a better figure lands. ──
const CLOUD_WH_PER_QUERY = 0.3
const CLOUD_PUE = 1.2
const CLOUD_J_PER_QUERY = CLOUD_WH_PER_QUERY * 3600 * CLOUD_PUE // ≈ 1296 J

const READ_METHODS = new Set(['recall', 'extract', 'extractive'])

export interface EnergyRecord {
  method: string
  is_read: boolean
  device_joules: number          // T1-grounded: measured watts × measured latency
  cloud_baseline_joules: number  // T2: derived
  delta_joules: number           // cloud − device (saved; negative ⇒ device spent more)
  device_tier: 'T1'
  cloud_tier: 'T2'
}

/** Energy for one dispatch, from its method + measured latency. */
export function energyFor(o: { method: string; latencyMs: number }): EnergyRecord {
  const is_read = READ_METHODS.has(o.method)
  const watts = is_read ? DEVICE_IDLE_W : DEVICE_GEN_W
  const device = Number((watts * (o.latencyMs / 1000)).toFixed(2))
  const cloud = Number(CLOUD_J_PER_QUERY.toFixed(2))
  return {
    method: o.method, is_read, device_joules: device, cloud_baseline_joules: cloud,
    delta_joules: Number((cloud - device).toFixed(2)), device_tier: 'T1', cloud_tier: 'T2',
  }
}

export interface EnergyAggregate {
  turns: number
  device_joules: number
  cloud_baseline_joules: number
  saved_joules: number
  saved_pct: number
  by_method: Record<string, { turns: number; device_joules: number; saved_joules: number }>
  read_share: number             // fraction of turns answered by a read (the amortization lever)
  /** Honest projection: per-turn saving × turns/day × 365 × users → annualized kWh. */
  annualized_kwh_per_1k_users: number
  methodology: { device_idle_w: number; device_gen_w: number; cloud_wh_per_query: number; cloud_pue: number; device_tier: 'T1'; cloud_tier: 'T2' }
}

/** Aggregate over recorded dispatches (each carries method + latency). */
export function aggregateEnergy(entries: { method: string; latencyMs: number }[], opts: { turnsPerUserPerDay?: number } = {}): EnergyAggregate {
  let device = 0, cloud = 0, reads = 0
  const by: Record<string, { turns: number; device_joules: number; saved_joules: number }> = {}
  for (const e of entries) {
    const r = energyFor(e)
    device += r.device_joules; cloud += r.cloud_baseline_joules
    if (r.is_read) reads++
    const b = (by[e.method] ??= { turns: 0, device_joules: 0, saved_joules: 0 })
    b.turns++; b.device_joules += r.device_joules; b.saved_joules += r.delta_joules
  }
  const n = entries.length || 1
  const saved = cloud - device
  const perTurnSavedJ = saved / n
  const tpd = opts.turnsPerUserPerDay ?? 20
  const annualized_kwh_per_1k_users = Number((perTurnSavedJ * tpd * 365 * 1000 / 3_600_000).toFixed(1))
  return {
    turns: entries.length,
    device_joules: Number(device.toFixed(1)), cloud_baseline_joules: Number(cloud.toFixed(1)),
    saved_joules: Number(saved.toFixed(1)), saved_pct: Number((100 * saved / (cloud || 1)).toFixed(1)),
    by_method: Object.fromEntries(Object.entries(by).map(([k, v]) => [k, { turns: v.turns, device_joules: Number(v.device_joules.toFixed(1)), saved_joules: Number(v.saved_joules.toFixed(1)) }])),
    read_share: Number((reads / n).toFixed(3)),
    annualized_kwh_per_1k_users,
    methodology: { device_idle_w: DEVICE_IDLE_W, device_gen_w: DEVICE_GEN_W, cloud_wh_per_query: CLOUD_WH_PER_QUERY, cloud_pue: CLOUD_PUE, device_tier: 'T1', cloud_tier: 'T2' },
  }
}
