/**
 * Graph-RL — the contextual bandit policy (LinUCB).
 *
 * This is the learned decision layer that CHOOSES a capability action given graph state
 * (graph-state.ts). Unlike the context-free UCB1 in capability-model.ts (which keys purely on
 * task/model), LinUCB conditions the choice on the graph neighbourhood the query landed in — so
 * the policy can learn e.g. "when the subgraph is mostly verified + dense, prefer graph-rag; when
 * it's sparse + hypothesised, prefer vector recall." That is the graph-native learning loop.
 *
 * LinUCB (Li et al. 2010), disjoint model: per action a, keep A_a = I + Σ x xᵀ and b_a = Σ r x.
 * θ_a = A_a⁻¹ b_a. Score p_a = θ_aᵀx + α·sqrt(xᵀ A_a⁻¹ x) — exploit + optimism-under-uncertainty.
 * We maintain A⁻¹ directly and update it in O(d²) via Sherman–Morrison, so there is no per-turn
 * matrix inversion. Pure + in-memory + serializable, mirroring capability-model.ts's house style.
 */

export interface ArmStanding {
  action: string
  plays: number
  mean_reward: number
  leading: boolean
}

interface Arm {
  Ainv: number[][] // (A)⁻¹, d×d, starts as I (ridge λ=1)
  b: number[] // d
  plays: number
  rewardSum: number
}

export class LinUCBPolicy {
  readonly dim: number
  readonly alpha: number
  private arms = new Map<string, Arm>()

  /** @param actions the discrete action set. @param dim context dimension. @param alpha exploration (higher = explore more). */
  constructor(actions: string[], dim: number, alpha = 1.0) {
    this.dim = dim
    this.alpha = alpha
    for (const a of actions) this.ensure(a)
  }

  private ensure(action: string): Arm {
    let arm = this.arms.get(action)
    if (!arm) {
      arm = { Ainv: identity(this.dim), b: zeros(this.dim), plays: 0, rewardSum: 0 }
      this.arms.set(action, arm)
    }
    return arm
  }

  /** Score every arm for a context and return the argmax (ties → first-declared / insertion order). */
  select(context: number[]): { action: string; scores: Record<string, number> } {
    const x = this.fit(context)
    const scores: Record<string, number> = {}
    let best = ''
    let bestScore = -Infinity
    for (const [action, arm] of this.arms) {
      const theta = matVec(arm.Ainv, arm.b)
      const mean = dot(theta, x)
      const variance = quadForm(arm.Ainv, x) // xᵀ A⁻¹ x ≥ 0
      const p = mean + this.alpha * Math.sqrt(Math.max(variance, 0))
      scores[action] = round(p)
      if (p > bestScore) { bestScore = p; best = action }
    }
    return { action: best, scores }
  }

  /** Online update after observing reward r∈[0,1] for taking `action` in `context`. */
  update(action: string, context: number[], reward: number): void {
    const arm = this.ensure(action)
    const x = this.fit(context)
    const r = Math.max(0, Math.min(1, reward))
    shermanMorrison(arm.Ainv, x) // A⁻¹ ← A⁻¹ after rank-1 A += x xᵀ
    for (let i = 0; i < this.dim; i++) arm.b[i]! += r * x[i]!
    arm.plays += 1
    arm.rewardSum += r
  }

  /** Pad/truncate a context to the policy's dimension so a featurizer change can't crash the loop. */
  private fit(context: number[]): number[] {
    if (context.length === this.dim) return context
    const x = zeros(this.dim)
    for (let i = 0; i < Math.min(this.dim, context.length); i++) x[i] = context[i]!
    return x
  }

  standings(): ArmStanding[] {
    const rows = [...this.arms.entries()].map(([action, a]) => ({
      action, plays: a.plays,
      mean_reward: a.plays ? round(a.rewardSum / a.plays) : 0,
      leading: false,
    }))
    const tried = rows.filter((r) => r.plays > 0)
    if (tried.length) tried.reduce((m, r) => (r.mean_reward > m.mean_reward ? r : m), tried[0]!).leading = true
    return rows.sort((a, b) => b.mean_reward - a.mean_reward)
  }

  serialize(): string {
    return JSON.stringify({ dim: this.dim, alpha: this.alpha, arms: [...this.arms.entries()].map(([action, a]) => ({ action, ...a })) })
  }

  hydrate(json: string): number {
    try {
      const d = JSON.parse(json) as { dim: number; arms: { action: string; Ainv: number[][]; b: number[]; plays: number; rewardSum: number }[] }
      if (d.dim !== this.dim) return 0 // dimension changed → discard stale weights rather than corrupt the policy
      let n = 0
      for (const a of d.arms) {
        if (!a?.action || !Array.isArray(a.Ainv) || !Array.isArray(a.b)) continue
        this.arms.set(a.action, { Ainv: a.Ainv, b: a.b, plays: a.plays ?? 0, rewardSum: a.rewardSum ?? 0 })
        n++
      }
      return n
    } catch { return 0 }
  }
}

// ── tiny linear algebra (d is small, ~10) ──────────────────────────────────────
function zeros(n: number): number[] { return new Array(n).fill(0) }
function identity(n: number): number[][] { return Array.from({ length: n }, (_, i) => { const r = zeros(n); r[i] = 1; return r }) }
function dot(a: number[], b: number[]): number { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!; return s }
function matVec(M: number[][], v: number[]): number[] { return M.map((row) => dot(row, v)) }
function quadForm(M: number[][], x: number[]): number { return dot(x, matVec(M, x)) }
function round(x: number): number { return Math.round(x * 1e4) / 1e4 }

/**
 * Sherman–Morrison rank-1 update: given Ainv = A⁻¹, update it in place to (A + x xᵀ)⁻¹.
 * (A + x xᵀ)⁻¹ = A⁻¹ − (A⁻¹ x xᵀ A⁻¹) / (1 + xᵀ A⁻¹ x).
 */
function shermanMorrison(Ainv: number[][], x: number[]): void {
  const n = x.length
  const Ax = matVec(Ainv, x) // A⁻¹ x
  const denom = 1 + dot(x, Ax)
  if (!Number.isFinite(denom) || Math.abs(denom) < 1e-12) return
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      Ainv[i]![j]! -= (Ax[i]! * Ax[j]!) / denom
    }
  }
}
