/**
 * Graph-RL — the loop orchestrator (Phase 1: retrieval-mode selection).
 *
 * Ties the pieces into one closed, graph-native, proof-carrying learning loop:
 *   decide:  graph state → featurize (graph-state.ts) → LinUCB select (grl-policy.ts) → retrieval mode
 *   observe: mine reward (grl-reward.ts) → policy.update → append a numeric transition → emit a
 *            proof-carrying ReasoningEvent → persist the learned weights.
 *
 * This is the template Phase 2 copies for the other heuristic policies (intent/operation routing,
 * proposal ranking). It reuses Noetica's existing signals and stays local-first; Phase 2 aggregates
 * the same transitions over the commons for community learning.
 *
 * Persistence + the transition log live under ~/.noetica (same store model as procedural-memory).
 * All filesystem + emit work is best-effort/fail-open — the learning loop must never break a turn.
 */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { LinUCBPolicy } from './grl-policy.js'
import { featurizeGraphState, GRAPH_STATE_DIM, type GraphState } from './graph-state.js'
import { grlReward, type RewardSignals } from './grl-reward.js'
import { contextFromBucket, type Transition, type CommunityPrior } from './grl-federation.js'
import { evaluatePolicy, type OpeResult } from './grl-ope.js'

/**
 * The retrieval GROUNDING-SOURCE the policy chooses among — folded from Noetica's real
 * intent-router `Retrieval` union into the choices that actually change grounding: the graph (kb),
 * doc embeddings (vector-rag), the web (web+vector), memory (episodic), or nothing. Kept small +
 * stable (LinUCB arms are keyed by name; never reorder/rename without a policy reset).
 */
export const RETRIEVAL_ACTIONS = ['kb', 'vector-rag', 'web+vector', 'episodic', 'none'] as const
export type RetrievalAction = (typeof RETRIEVAL_ACTIONS)[number]

/** Fold the full intent-router Retrieval union onto the policy's action set. */
export function retrievalActionOf(retrieval: string): RetrievalAction {
  switch (retrieval) {
    case 'kb': case 'program-aided': case 'program-aided+barriers': return 'kb'
    case 'vector-rag': return 'vector-rag'
    case 'web+vector': return 'web+vector'
    case 'episodic': case 'self-model': return 'episodic'
    default: return 'none' // none, memory-write, status
  }
}

/** Proof-carrying emit hook (server injects emitReasoningEvent; default no-op for tests/offline). */
export type EmitFn = (event: { type: string; payload: Record<string, unknown> }) => void

export interface GrlLoopOpts {
  storeDir?: string
  alpha?: number
  emit?: EmitFn
  actions?: readonly string[]
  saveEvery?: number
}

/**
 * Build a (coarse) GraphState from the per-turn PLN graph-grounding assessment that Noetica already
 * computes (pln-judgment.assessAgainstGraph: which claim-entities are KNOWN to the graph vs NOVEL).
 * Grounded claims → high-trust mass, novel claims → hypothesis mass. Phase 2 enriches this with full
 * neighbourhood analytics (PPR concentration, degree, community); Phase 1 learns from the coarse state.
 */
export function graphStateFromGrounding(gg: { graphGrounding?: number; grounded?: string[]; novel?: string[] }, query: string): GraphState {
  const groundedN = gg.grounded?.length ?? Math.round((gg.graphGrounding ?? 0) * 5)
  const novelN = gg.novel?.length ?? 0
  const size = Math.max(groundedN + novelN, 1)
  return {
    epistemic: { verified: groundedN, hypothesis: novelN },
    subgraphSize: size,
    edgeCount: groundedN, // each grounded claim implies ≥1 grounding edge (weak proxy until Phase 2)
    topNodeShare: 0, // unknown pre-retrieval; Phase 2 supplies PPR concentration
    grounded: (gg.graphGrounding ?? 0) >= 0.5,
    queryTokens: query.trim().split(/\s+/).filter(Boolean).length,
  }
}

export class GrlLoop {
  private policy: LinUCBPolicy
  private emit: EmitFn
  private storeDir: string
  private policyFile: string
  private txFile: string
  private saveEvery: number
  private sinceSave = 0
  private alpha: number
  private recent: Transition[] = [] // in-memory ring of recent transitions, for opt-in mesh publishing

  constructor(opts: GrlLoopOpts = {}) {
    const actions = opts.actions ?? RETRIEVAL_ACTIONS
    this.alpha = opts.alpha ?? 0.7
    this.policy = new LinUCBPolicy([...actions], GRAPH_STATE_DIM, this.alpha)
    this.emit = opts.emit ?? (() => {})
    this.storeDir = opts.storeDir ?? path.join(os.homedir(), '.noetica')
    this.policyFile = path.join(this.storeDir, 'grl-retrieval-policy.json')
    this.txFile = path.join(this.storeDir, 'grl-transitions.jsonl')
    this.saveEvery = opts.saveEvery ?? 10
    this.load()
  }

  /** Decide the retrieval mode for a query's graph neighbourhood. Returns the context so observe() can reward it. */
  decide(gs: GraphState): { action: string; context: number[]; scores: Record<string, number> } {
    const context = featurizeGraphState(gs)
    const { action, scores } = this.policy.select(context)
    this.emit({ type: 'noetica.grl.decide', payload: { policy: 'retrieval-mode', action, scores, dim: context.length } })
    return { action, context, scores }
  }

  /** Observe the outcome: mine reward, update the policy, log the transition, emit a receipt, persist. */
  observe(o: { turnId?: string; action: string; context: number[]; signals: RewardSignals }): number | null {
    const reward = grlReward(o.signals)
    if (reward === null) return null // no signal → no update (never invent a reward)
    this.policy.update(o.action, o.context, reward)
    this.recent.push({ action: o.action, context: o.context, reward })
    if (this.recent.length > 200) this.recent.shift()
    this.appendTransition({ ts: new Date().toISOString(), turnId: o.turnId, action: o.action, context: o.context, reward, signals: o.signals })
    this.emit({ type: 'noetica.grl.reward', payload: { policy: 'retrieval-mode', turnId: o.turnId, action: o.action, reward } })
    if (++this.sinceSave >= this.saveEvery) { this.save(); this.sinceSave = 0 }
    return reward
  }

  standings() { return this.policy.standings() }

  // ── Multi-policy spine (GRL Phase 2): the same graph-state → LinUCB → reward template, applied to
  // OTHER heuristic decisions (operation route, proposal ranking). Additive — the retrieval path above
  // is untouched. Each named policy has its own arms + persisted weights; all share the featurizer,
  // reward mining, transition log and mesh federation. This is how "everything learns over the graph".
  private extra = new Map<string, LinUCBPolicy>()

  private named(policyName: string, actions: readonly string[]): LinUCBPolicy {
    let p = this.extra.get(policyName)
    if (!p) {
      p = new LinUCBPolicy([...actions], GRAPH_STATE_DIM, this.alpha)
      try {
        const f = path.join(this.storeDir, `grl-${policyName}-policy.json`)
        if (fs.existsSync(f)) p.hydrate(fs.readFileSync(f, 'utf8'))
      } catch { /* fail-open: start cold */ }
      this.extra.set(policyName, p)
    }
    return p
  }

  /** Decide for a NAMED policy over the shared graph state (multi-policy spine). */
  decideFor(policyName: string, actions: readonly string[], gs: GraphState): { action: string; context: number[]; scores: Record<string, number> } {
    const context = featurizeGraphState(gs)
    const { action, scores } = this.named(policyName, actions).select(context)
    this.emit({ type: 'noetica.grl.decide', payload: { policy: policyName, action, scores } })
    return { action, context, scores }
  }

  /** Observe an outcome for a NAMED policy (multi-policy spine). Shares reward mining + transition log + mesh. */
  observeFor(policyName: string, actions: readonly string[], o: { turnId?: string; action: string; context: number[]; signals: RewardSignals }): number | null {
    const reward = grlReward(o.signals)
    if (reward === null) return null
    this.named(policyName, actions).update(o.action, o.context, reward)
    this.recent.push({ action: `${policyName}:${o.action}`, context: o.context, reward })
    if (this.recent.length > 200) this.recent.shift()
    this.appendTransition({ ts: new Date().toISOString(), turnId: o.turnId, policy: policyName, action: o.action, context: o.context, reward, signals: o.signals })
    this.emit({ type: 'noetica.grl.reward', payload: { policy: policyName, turnId: o.turnId, action: o.action, reward } })
    if (++this.sinceSave >= this.saveEvery) { this.save(); this.sinceSave = 0 }
    return reward
  }

  standingsFor(policyName: string) { return this.extra.get(policyName)?.standings() ?? [] }

  /**
   * Offline-evaluate whether a policy is READY to flip from shadow to active — Direct-Method OPE over the
   * append-only replay buffer (grl-ope.ts). This is the operational form of the "shadow-before-active"
   * invariant: a policy only earns the right to DRIVE decisions once it provably beats the heuristic on
   * logged data. Read /api/grl/readiness before setting NOETICA_GRL_ACTIVE.
   */
  readiness(policyName = 'retrieval-mode', actions: readonly string[] = RETRIEVAL_ACTIONS): OpeResult {
    const txns: Transition[] = []
    try {
      if (fs.existsSync(this.txFile)) {
        for (const line of fs.readFileSync(this.txFile, 'utf8').split('\n')) {
          if (!line.trim()) continue
          const row = JSON.parse(line) as { policy?: string; action?: string; context?: number[]; reward?: number }
          if ((row.policy ?? 'retrieval-mode') !== policyName) continue // retrieval logs without a policy field
          if (Array.isArray(row.context) && typeof row.reward === 'number' && typeof row.action === 'string') {
            txns.push({ action: row.action, context: row.context, reward: row.reward })
          }
        }
      }
    } catch { /* fail-open: no buffer → not ready */ }
    return evaluatePolicy(txns, { actions: [...actions] })
  }

  /** Recent transitions (for the opt-in mesh to publish gate-redacted). */
  recentTransitions(): Transition[] { return this.recent.slice() }

  /**
   * Warm-start the local policy from the community prior pulled off the grl-mesh: apply a few bounded
   * pseudo-observations per (action, context-bucket) at the community mean. Bounded so the community
   * informs but never dominates a node's own learned signal (sovereignty: local experience wins over time).
   */
  seedFromPrior(priors: CommunityPrior[], maxPseudo = 5): number {
    let applied = 0
    for (const p of priors) {
      const ctx = contextFromBucket(p.context_bucket)
      const k = Math.min(p.n, maxPseudo)
      for (let i = 0; i < k; i++) { this.policy.update(p.action, ctx, p.mean_reward); applied++ }
    }
    return applied
  }

  /** Flush learned weights to disk (also called on a cadence from observe). */
  save(): void {
    try {
      fs.mkdirSync(this.storeDir, { recursive: true })
      fs.writeFileSync(this.policyFile, this.policy.serialize())
      for (const [name, p] of this.extra) fs.writeFileSync(path.join(this.storeDir, `grl-${name}-policy.json`), p.serialize())
    } catch { /* fail-open: a save failure must not break the turn */ }
  }

  private load(): void {
    try {
      if (fs.existsSync(this.policyFile)) this.policy.hydrate(fs.readFileSync(this.policyFile, 'utf8'))
    } catch { /* fail-open: start cold */ }
  }

  // The numeric replay buffer (the piece missing for gradient/offline RL). Append-only JSONL of
  // (context, action, reward) transitions — the training set Phase 3's GNN/offline learner consumes.
  private appendTransition(row: Record<string, unknown>): void {
    try {
      fs.mkdirSync(this.storeDir, { recursive: true })
      fs.appendFileSync(this.txFile, JSON.stringify(row) + '\n')
    } catch { /* fail-open */ }
  }
}

// ── module singleton (the hot-path loop) ───────────────────────────────────────
let _loop: GrlLoop | null = null
export function grlLoop(): GrlLoop { return (_loop ??= new GrlLoop()) }
/** Inject the proof-carrying emitter once at boot (server wires emitReasoningEvent). */
export function grlConfigure(opts: GrlLoopOpts): void { _loop = new GrlLoop(opts) }
/** Retrieval-mode selection is opt-out via env; default on so the loop actually learns in prod. */
export function grlEnabled(): boolean { return process.env['NOETICA_GRL_RETRIEVAL'] !== '0' }
/**
 * ACTIVE = the learned policy actually DRIVES the retrieval decision (vs shadow, where it only learns).
 * Explicit opt-in AND default-off: flip NOETICA_GRL_ACTIVE=1 only after GET /api/grl/readiness reports
 * readyToFlip=true. This encodes shadow-before-active in the wiring, not just the docs.
 */
export function grlActive(): boolean { return process.env['NOETICA_GRL_ACTIVE'] === '1' }

/** ε-greedy shadow-exploration budget (NOETICA_GRL_EXPLORE ∈ [0,1], default 0 = off). */
export function grlExploreEpsilon(): number {
  const e = Number(process.env['NOETICA_GRL_EXPLORE'] ?? '0')
  return Number.isFinite(e) ? Math.max(0, Math.min(1, e)) : 0
}
/**
 * Breaks the shadow→active GRADUATION DEADLOCK. In pure shadow the logged action is always the heuristic's,
 * so the OPE gate can never accumulate support for an action the policy would deviate to → readyToFlip can
 * never become true for a policy that changes anything. With probability ε this returns true, and the caller
 * TAKES the policy's action for that turn (so it is actually logged + rewarded). Opt-in, default off.
 */
export function grlExplore(): boolean { return Math.random() < grlExploreEpsilon() }
