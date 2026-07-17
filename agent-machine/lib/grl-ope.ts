/**
 * grl-ope — offline policy evaluation (OPE) for the Graph-RL readiness gate.
 *
 * The framework's load-bearing invariant is "shadow-before-active": a policy learns in shadow and is
 * only flipped to actually DRIVE decisions once it provably beats the incumbent heuristic — on data, not
 * vibes. This is that gate. It runs the **Direct Method** over the append-only replay buffer: fit a
 * nonparametric reward model r̂(context-bucket, action) from the logged (heuristic) transitions, then
 * estimate the LEARNED policy's value vs the heuristic's realized value on the same distribution.
 *
 * Honesty is built in: the DM can only score actions the log actually explored, so `supportedFraction`
 * reports how much of the learned policy's behaviour is validatable — a policy that picks lots of
 * never-explored actions is NOT ready (needs more shadow exploration), and the gate says so.
 */
import { LinUCBPolicy } from './grl-policy.js'
import { GRAPH_STATE_DIM } from './graph-state.js'
import { bucketOf, type Transition } from './grl-federation.js'

export interface OpeResult {
  transitions: number
  buckets: number
  loggedValue: number        // mean reward the logging (heuristic) policy realized
  learnedValue: number       // Direct-Method estimate of the learned policy's value (supported buckets)
  lift: number               // learnedValue − loggedValue
  liftPct: number            // lift as a % of loggedValue
  supportedFraction: number  // fraction of traffic where the learned action has reward-model support
  readyToFlip: boolean
  reason: string
}

export interface OpeOptions {
  actions: string[]
  alpha?: number
  minTransitions?: number    // need this much data before any verdict
  minSupport?: number        // learned policy must be validatable on ≥ this fraction of traffic
  minLiftPct?: number        // and beat the heuristic by ≥ this %
}

/** Direct-Method OPE: is the learned policy's estimated value above the heuristic's realized value? */
export function evaluatePolicy(transitions: Transition[], opts: OpeOptions): OpeResult {
  const minN = opts.minTransitions ?? 200
  const minSupport = opts.minSupport ?? 0.8
  const minLiftPct = opts.minLiftPct ?? 2

  // 1. reward model r̂(bucket|action) + per-bucket logged reward + bucket frequency, from the log.
  const model = new Map<string, { sum: number; n: number }>()        // "bucket|action" → stats
  const loggedByBucket = new Map<string, { sum: number; n: number }>() // bucket → heuristic realized reward
  for (const t of transitions) {
    const b = bucketOf(t.context)
    const mk = `${b}|${t.action}`
    const m = model.get(mk) ?? { sum: 0, n: 0 }
    m.sum += t.reward; m.n++; model.set(mk, m)
    const lb = loggedByBucket.get(b) ?? { sum: 0, n: 0 }
    lb.sum += t.reward; lb.n++; loggedByBucket.set(b, lb)
  }

  // 2. the LEARNED policy = a LinUCB fit on the whole log. alpha=0 → GREEDY select for evaluation: OPE asks
  // "what would the deployed (exploit) policy do", not "what would it explore", so the exploration bonus
  // (which favours under-tried arms) must be off here.
  const policy = new LinUCBPolicy(opts.actions, GRAPH_STATE_DIM, 0)
  for (const t of transitions) policy.update(t.action, t.context, t.reward)

  // 3. Per-TRANSITION on the REAL logged context (not a bucket representative — those don't match the
  // training distribution): the greedy learned action, its DM-estimated reward (if the log explored that
  // action in that bucket), vs what the heuristic actually realized. Compare on the SUPPORTED mass only.
  const total = transitions.length
  let wLearned = 0, wLoggedSupported = 0, nSupported = 0
  for (const t of transitions) {
    const b = bucketOf(t.context)
    const learnedAction = policy.select(t.context).action
    const est = model.get(`${b}|${learnedAction}`)
    if (est && est.n > 0) {                 // supported: the log explored this action in this bucket
      wLearned += est.sum / est.n           // DM estimate of the learned action's reward here
      wLoggedSupported += t.reward          // what the heuristic actually got on this same transition
      nSupported++
    }
  }
  const supportedFraction = total ? nSupported / total : 0
  const learnedValue = nSupported ? wLearned / nSupported : 0
  const loggedOnSupported = nSupported ? wLoggedSupported / nSupported : 0
  const lift = learnedValue - loggedOnSupported
  const liftPct = loggedOnSupported > 0 ? (lift / loggedOnSupported) * 100 : 0

  let readyToFlip = true
  let reason = 'learned policy beats the heuristic on validated traffic — safe to flip active'
  if (total < minN) { readyToFlip = false; reason = `insufficient data (${total} < ${minN} transitions)` }
  else if (supportedFraction < minSupport) { readyToFlip = false; reason = `learned policy under-validated (support ${(supportedFraction * 100).toFixed(0)}% < ${minSupport * 100}%) — needs more shadow exploration` }
  else if (liftPct < minLiftPct) { readyToFlip = false; reason = `lift ${liftPct.toFixed(1)}% < ${minLiftPct}% — not clearly better than the heuristic` }

  return {
    transitions: total, buckets: loggedByBucket.size,
    loggedValue: round(loggedOnSupported), learnedValue: round(learnedValue),
    lift: round(lift), liftPct: round(liftPct), supportedFraction: round(supportedFraction),
    readyToFlip, reason,
  }
}

function round(x: number): number { return Math.round(x * 1e4) / 1e4 }
