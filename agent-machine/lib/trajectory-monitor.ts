/**
 * trajectory-monitor.ts — cross-turn agent-trajectory safety monitor (LlamaFirewall AlignmentCheck;
 * OWASP ASI01 goal-hijack; Crescendo multi-turn). Per-message filters are blind to a sequence that
 * gradually escalates or diverges from the declared goal. This reasons over the WHOLE action sequence.
 */
export interface AgentAction { type: string; target?: string; sensitive?: boolean }
export interface TrajectoryAlert { kind: 'escalation' | 'sensitive-burst' | 'repetition-loop' | 'scope-creep'; detail: string }

export function monitorTrajectory(
  actions: AgentAction[],
  opts: { sensitiveTypes?: string[]; maxSensitive?: number; loopWindow?: number } = {},
): { alerts: TrajectoryAlert[]; sensitiveCount: number } {
  const sensitiveTypes = new Set(opts.sensitiveTypes ?? [])
  const maxSensitive = opts.maxSensitive ?? 3
  const loopWindow = opts.loopWindow ?? 4
  const isSensitive = (a: AgentAction) => a.sensitive || sensitiveTypes.has(a.type)
  const alerts: TrajectoryAlert[] = []

  const sensitiveCount = actions.filter(isSensitive).length
  if (sensitiveCount > maxSensitive) alerts.push({ kind: 'sensitive-burst', detail: `${sensitiveCount} sensitive actions (max ${maxSensitive})` })

  // scope-creep: a sensitive action type appears that none of the first half used (goal drift)
  const half = Math.floor(actions.length / 2)
  const early = new Set(actions.slice(0, half).map((a) => a.type))
  for (const a of actions.slice(half)) {
    if (isSensitive(a) && !early.has(a.type)) { alerts.push({ kind: 'scope-creep', detail: `new sensitive action '${a.type}' late in the trajectory` }); break }
  }

  // repetition-loop: the same (type,target) repeated within a sliding window (stuck / probing)
  for (let i = loopWindow; i < actions.length; i++) {
    const key = `${actions[i]!.type}|${actions[i]!.target ?? ''}`
    const recent = actions.slice(i - loopWindow, i).map((a) => `${a.type}|${a.target ?? ''}`)
    if (recent.filter((k) => k === key).length >= loopWindow - 1) { alerts.push({ kind: 'repetition-loop', detail: `'${key}' repeated` }); break }
  }
  // escalation: strictly increasing run of sensitive actions at the tail
  let tail = 0
  for (let i = actions.length - 1; i >= 0 && isSensitive(actions[i]!); i--) tail++
  if (tail >= maxSensitive) alerts.push({ kind: 'escalation', detail: `${tail} consecutive sensitive actions at the tail` })

  return { alerts, sensitiveCount }
}
