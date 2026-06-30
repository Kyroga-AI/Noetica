/**
 * phantom-anomaly — dynamical-systems anomaly detection (FTLE + Echo State Network).
 *
 * geo-anomaly.ts catches *spatial* surprise (a cell heating up vs its baseline). phantom catches
 * *temporal/dynamical* surprise in a signal's evolution — the kind a z-score misses because the value
 * itself looks normal while the system's TRAJECTORY has gone off-manifold. Two complementary detectors:
 *
 *  1. Echo State Network (reservoir computing). A fixed random recurrent reservoir projects the signal
 *     into a high-dimensional state; a cheap linear readout is trained (ridge regression) to predict the
 *     next step. After warm-up the readout is frozen and the one-step prediction RESIDUAL becomes the
 *     anomaly score: a well-modelled regime predicts well (low residual); a novel regime the reservoir
 *     never learned predicts badly (high residual). ESNs are the right tool here because training is a
 *     single closed-form ridge solve — no backprop, fast enough to run on-device per series.
 *
 *  2. FTLE (finite-time Lyapunov exponent). Estimates the local exponential rate at which nearby
 *     trajectories diverge over a short horizon. A spike in FTLE means the system entered a chaotic /
 *     sensitive regime — an early-warning signal that precedes the value itself looking anomalous.
 *
 * Pure numeric, dependency-free, deterministic (seeded PRNG for the reservoir so results reproduce).
 */

// ── Deterministic PRNG (mulberry32) — reservoirs must reproduce across runs for auditable scores. ──
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface EsnOptions {
  /** Reservoir size (neurons). */
  reservoirSize?: number
  /** Spectral-radius-like scaling of the recurrent matrix (<1 keeps the echo-state property). */
  spectralRadius?: number
  /** Input scaling. */
  inputScale?: number
  /** Leak rate (0,1] — state memory vs responsiveness. */
  leak?: number
  /** Ridge regularization for the readout solve. */
  ridge?: number
  /** Steps to discard before training the readout (transient washout). */
  washout?: number
  /** PRNG seed (reproducible reservoirs). */
  seed?: number
}

export interface AnomalyPoint {
  index: number
  value: number
  /** One-step prediction residual (ESN), normalized to a robust z-score. */
  esnZ: number
  /** Raw finite-time Lyapunov exponent estimate at this point (higher = more local divergence). */
  ftle: number
  /** FTLE normalized to a robust z-score against the series' own FTLE baseline. */
  ftleZ: number
  /** True when esnZ or ftleZ exceeds the configured z-threshold. */
  anomalous: boolean
}

export interface PhantomResult {
  points: AnomalyPoint[]
  /** Indices flagged anomalous. */
  anomalies: number[]
  esnTrainRmse: number
}

function tanh(x: number): number { return Math.tanh(x) }

/**
 * Run an Echo State Network over a 1-D series and return the per-step one-step-ahead residual.
 * The readout is trained (ridge) on [washout, split) and the residual is reported for the whole series.
 */
function esnResiduals(series: number[], opts: Required<EsnOptions>): { residuals: number[]; trainRmse: number } {
  const n = series.length
  const N = opts.reservoirSize
  const rng = mulberry32(opts.seed)

  // Input weights Win (N x 1) and recurrent W (N x N), scaled.
  const Win = new Float64Array(N)
  for (let i = 0; i < N; i++) Win[i] = (rng() * 2 - 1) * opts.inputScale
  const W = new Float64Array(N * N)
  for (let i = 0; i < N * N; i++) W[i] = rng() * 2 - 1
  // Scale W toward the desired spectral radius via its (cheap) max-abs-row-sum bound.
  let maxRow = 0
  for (let i = 0; i < N; i++) {
    let s = 0
    for (let j = 0; j < N; j++) s += Math.abs(W[i * N + j]!)
    if (s > maxRow) maxRow = s
  }
  const wScale = maxRow > 0 ? opts.spectralRadius / maxRow : 0
  for (let i = 0; i < N * N; i++) W[i]! *= wScale

  // Collect reservoir states.
  const states: Float64Array[] = []
  let x = new Float64Array(N)
  for (let t = 0; t < n; t++) {
    const u = series[t]!
    const xNew = new Float64Array(N)
    for (let i = 0; i < N; i++) {
      let pre = Win[i]! * u
      const row = i * N
      for (let j = 0; j < N; j++) pre += W[row + j]! * x[j]!
      xNew[i] = (1 - opts.leak) * x[i]! + opts.leak * tanh(pre)
    }
    x = xNew
    states.push(x)
  }

  // Train ridge readout to predict series[t+1] from state[t], over [washout, n-1).
  // Closed form per-feature via normal equations with diagonal ridge (states are the design matrix).
  const trainStart = opts.washout
  const trainEnd = n - 1
  // Build A^T A (N x N) and A^T b (N) incrementally.
  const AtA = new Float64Array(N * N)
  const Atb = new Float64Array(N)
  for (let t = trainStart; t < trainEnd; t++) {
    const s = states[t]!
    const target = series[t + 1]!
    for (let i = 0; i < N; i++) {
      const si = s[i]!
      Atb[i]! += si * target
      const row = i * N
      for (let j = i; j < N; j++) {
        const v = si * s[j]!
        AtA[row + j]! += v
        if (j !== i) AtA[j * N + i]! += v
      }
    }
  }
  for (let i = 0; i < N; i++) AtA[i * N + i]! += opts.ridge

  // Solve (AtA) w = Atb via Cholesky (AtA is SPD with ridge).
  const w = choleskySolve(AtA, Atb, N)

  // Residuals across the whole series (one-step prediction).
  const residuals: number[] = new Array(n).fill(0)
  let se = 0, cnt = 0
  for (let t = 0; t < n - 1; t++) {
    const s = states[t]!
    let pred = 0
    for (let i = 0; i < N; i++) pred += w[i]! * s[i]!
    const r = series[t + 1]! - pred
    residuals[t + 1] = Math.abs(r)
    if (t >= trainStart) { se += r * r; cnt++ }
  }
  return { residuals, trainRmse: cnt ? Math.sqrt(se / cnt) : 0 }
}

/** In-place Cholesky factorization + solve for SPD matrix A (N x N, row-major) and rhs b. */
function choleskySolve(A: Float64Array, b: Float64Array, N: number): Float64Array {
  const L = new Float64Array(N * N)
  for (let i = 0; i < N; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = A[i * N + j]!
      for (let k = 0; k < j; k++) sum -= L[i * N + k]! * L[j * N + k]!
      if (i === j) {
        L[i * N + j] = Math.sqrt(Math.max(sum, 1e-12))
      } else {
        L[i * N + j] = sum / (L[j * N + j]! || 1e-12)
      }
    }
  }
  // Forward solve L y = b
  const y = new Float64Array(N)
  for (let i = 0; i < N; i++) {
    let sum = b[i]!
    for (let k = 0; k < i; k++) sum -= L[i * N + k]! * y[k]!
    y[i] = sum / (L[i * N + i]! || 1e-12)
  }
  // Back solve L^T w = y
  const w = new Float64Array(N)
  for (let i = N - 1; i >= 0; i--) {
    let sum = y[i]!
    for (let k = i + 1; k < N; k++) sum -= L[k * N + i]! * w[k]!
    w[i] = sum / (L[i * N + i]! || 1e-12)
  }
  return w
}

/**
 * Finite-time Lyapunov exponent over a sliding window. Embeds the series in a delay space and measures
 * the mean log-growth of the nearest-neighbour distance over `horizon` steps (Rosenstein-style estimate).
 */
export function ftleSeries(series: number[], opts: { window?: number; horizon?: number } = {}): number[] {
  const window = opts.window ?? 16
  const horizon = opts.horizon ?? 4
  const n = series.length
  const out = new Array(n).fill(0)
  for (let t = window; t < n - horizon; t++) {
    // Reference point and a short past window; find the nearest prior point by value-neighbourhood.
    const ref = series[t]!
    let bestIdx = -1, bestDist = Infinity
    for (let j = t - window; j < t; j++) {
      const d = Math.abs(series[j]! - ref)
      if (d < bestDist && d > 0) { bestDist = d; bestIdx = j }
    }
    if (bestIdx < 0 || bestIdx + horizon >= n) continue
    const dEnd = Math.abs(series[t + horizon]! - series[bestIdx + horizon]!)
    if (bestDist > 0 && dEnd > 0) {
      out[t] = Math.log(dEnd / bestDist) / horizon
    }
  }
  return out
}

const DEFAULTS: Required<EsnOptions> = {
  reservoirSize: 40, spectralRadius: 0.9, inputScale: 0.5, leak: 0.3, ridge: 1e-3, washout: 10, seed: 1337,
}

/**
 * Detect anomalies in a 1-D time series with the combined ESN-residual + FTLE detectors.
 * `zThreshold` is in standard deviations of the ESN residual; `ftleThreshold` flags divergence spikes.
 */
export function detectAnomalies(
  series: number[],
  opts: EsnOptions & { zThreshold?: number } = {},
): PhantomResult {
  const cfg = { ...DEFAULTS, ...opts }
  const zThreshold = opts.zThreshold ?? 3

  if (series.length < cfg.washout + 4) {
    // Too short to model — return a clean result rather than throw.
    return {
      points: series.map((value, index) => ({ index, value, esnZ: 0, ftle: 0, ftleZ: 0, anomalous: false })),
      anomalies: [],
      esnTrainRmse: 0,
    }
  }

  const { residuals, trainRmse } = esnResiduals(series, cfg)
  const ftle = ftleSeries(series, {})

  // Robust z-score (median + MAD): both detectors are flagged relative to their OWN baseline, so a
  // smooth signal (uniformly moderate FTLE, low residual) stays clean while a genuine spike stands out.
  const robustZ = (arr: number[]): ((x: number) => number) => {
    const sorted = [...arr].sort((a, b) => a - b)
    const median = sorted[Math.floor(sorted.length / 2)] ?? 0
    const absDev = arr.map((v) => Math.abs(v - median)).sort((a, b) => a - b)
    const mad = absDev[Math.floor(absDev.length / 2)] ?? 0
    const scale = mad > 0 ? mad * 1.4826 : 1
    return (x: number) => (x - median) / (scale || 1)
  }
  // The reservoir starts at zero and needs `washout` steps to reach its echo state; predictions before
  // then are warm-up transient, not anomalies. Score (and build the baseline) only past the washout.
  const esnZof = robustZ(residuals.slice(cfg.washout))
  const ftleZof = robustZ(ftle.map(Math.abs))

  const points: AnomalyPoint[] = series.map((value, index) => {
    const scored = index >= cfg.washout
    const esnZ = scored ? esnZof(residuals[index]!) : 0
    const f = ftle[index] ?? 0
    const ftleZ = ftleZof(Math.abs(f))
    const anomalous = scored && (esnZ >= zThreshold || ftleZ >= zThreshold)
    return { index, value, esnZ, ftle: f, ftleZ, anomalous }
  })

  return { points, anomalies: points.filter((p) => p.anomalous).map((p) => p.index), esnTrainRmse: trainRmse }
}
