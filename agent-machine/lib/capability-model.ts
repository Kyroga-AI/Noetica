/**
 * Self-model: the agent's rolling model of its OWN performance per task family
 * and model. Fed from completed governance runs. This is what lets Noetica reason
 * about where it's strong locally vs. where it should escalate — something a
 * stateless cloud chat cannot do.
 *
 * In-memory and session-scoped (resets on restart), like the governance ring.
 */

export interface CapabilityStat {
  task: string
  provider: string
  model: string
  runs: number
  errors: number
  totalLatencyMs: number
  totalCostUsd: number
  /** Sum of reward signals (VJ worth + user feedback), for bandit routing. */
  totalReward: number
  rewardCount: number
  lastUpdated: string
}

const _caps = new Map<string, CapabilityStat>()

function keyOf(task: string, provider: string, model: string): string {
  return `${task}::${provider}:${model}`
}

function isLocal(provider: string): boolean {
  return provider === 'ollama' || provider === 'meta'
}

export function recordCapability(o: {
  task?: string
  provider: string
  model: string
  latencyMs: number
  error?: boolean
  costUsd?: number
}): void {
  const task = o.task || 'general'
  const k = keyOf(task, o.provider, o.model)
  const s = _caps.get(k) ?? {
    task, provider: o.provider, model: o.model,
    runs: 0, errors: 0, totalLatencyMs: 0, totalCostUsd: 0, totalReward: 0, rewardCount: 0, lastUpdated: '',
  }
  s.runs += 1
  if (o.error) s.errors += 1
  s.totalLatencyMs += o.latencyMs ?? 0
  s.totalCostUsd += o.costUsd ?? 0
  s.lastUpdated = new Date().toISOString()
  _caps.set(k, s)
}

// Reward signal for bandit routing: VJ worth (auto) or user feedback (manual),
// in [0,1]. Errors should record a 0 reward so the arm is penalised.
export function recordReward(o: { task?: string; provider: string; model: string; reward: number }): void {
  const task = o.task || 'general'
  const k = keyOf(task, o.provider, o.model)
  const s = _caps.get(k) ?? {
    task, provider: o.provider, model: o.model,
    runs: 0, errors: 0, totalLatencyMs: 0, totalCostUsd: 0, totalReward: 0, rewardCount: 0, lastUpdated: '',
  }
  s.totalReward += Math.max(0, Math.min(1, o.reward))
  s.rewardCount += 1
  s.lastUpdated = new Date().toISOString()
  _caps.set(k, s)
}

/**
 * UCB1 multi-armed bandit selection over candidate local models for a task.
 * Balances exploitation (high mean reward) with exploration (under-tried arms).
 * Untried candidates are selected first (Infinity score). Returns the chosen
 * model name, or undefined if no candidates were given.
 */
export function selectArmUCB(task: string, candidates: string[], provider = 'ollama'): string | undefined {
  if (candidates.length === 0) return undefined
  if (candidates.length === 1) return candidates[0]
  const stats = candidates.map((model) => _caps.get(keyOf(task, provider, model)))
  const totalPlays = stats.reduce((s, st) => s + (st?.rewardCount ?? 0), 0)
  // Cold start: if nothing has been tried, pick the first candidate deterministically.
  if (totalPlays === 0) return candidates[0]
  const C = 1.4 // exploration constant (~sqrt(2))
  let best = candidates[0]!
  let bestScore = -Infinity
  for (let i = 0; i < candidates.length; i++) {
    const st = stats[i]
    const plays = st?.rewardCount ?? 0
    if (plays === 0) return candidates[i]! // explore untried arm immediately
    const mean = (st!.totalReward) / plays
    const score = mean + C * Math.sqrt(Math.log(totalPlays) / plays)
    if (score > bestScore) { bestScore = score; best = candidates[i]! }
  }
  return best
}

export interface CapabilityRow {
  task: string
  provider: string
  model: string
  is_local: boolean
  runs: number
  success_rate: number
  avg_latency_ms: number
  avg_cost_usd: number
  last_updated: string
}

export function capabilitySummary(): CapabilityRow[] {
  return [..._caps.values()].map((s) => ({
    task: s.task,
    provider: s.provider,
    model: s.model,
    is_local: isLocal(s.provider),
    runs: s.runs,
    success_rate: s.runs ? (s.runs - s.errors) / s.runs : 0,
    avg_latency_ms: s.runs ? Math.round(s.totalLatencyMs / s.runs) : 0,
    avg_cost_usd: s.runs ? s.totalCostUsd / s.runs : 0,
    last_updated: s.lastUpdated,
  })).sort((a, b) => (a.task === b.task ? b.runs - a.runs : a.task.localeCompare(b.task)))
}

/**
 * Routing hint for a task: should we escalate off the local model? Conservative —
 * only recommends escalation once there's enough signal (>= MIN_RUNS) AND the
 * local success rate is genuinely poor. Used only when capability routing is
 * explicitly enabled (NOETICA_CAPABILITY_ROUTING=1).
 */
export function capabilityHint(task: string): {
  recommendEscalation: boolean
  localSuccessRate: number | null
  localRuns: number
} {
  const MIN_RUNS = 5
  const POOR_THRESHOLD = 0.6
  const rows = capabilitySummary().filter((r) => r.task === task && r.is_local)
  if (rows.length === 0) return { recommendEscalation: false, localSuccessRate: null, localRuns: 0 }
  // Aggregate across local models for the task
  const runs = rows.reduce((s, r) => s + r.runs, 0)
  const weightedSuccess = rows.reduce((s, r) => s + r.success_rate * r.runs, 0) / Math.max(runs, 1)
  return {
    recommendEscalation: runs >= MIN_RUNS && weightedSuccess < POOR_THRESHOLD,
    localSuccessRate: weightedSuccess,
    localRuns: runs,
  }
}
