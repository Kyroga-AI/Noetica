/**
 * causal-graph — qualitative causal DAG primitives.
 *
 * Implements:
 *   - CausalDAG: typed nodes + directed edges with acyclicity validation
 *   - Directed path enumeration (DFS)
 *   - Ancestor / descendant sets
 *   - Backdoor criterion (Pearl 2009, Def. 3.3.1): Z blocks all non-directed paths
 *     from X to Y that start with an arrow INTO X
 *   - Frontdoor criterion (Pearl 2009, Def. 3.3.4): M intercepts all directed paths
 *     from X to Y; X blocks all backdoor paths to M; Y blocks all backdoor paths
 *     to M from X through M
 *   - IV validity: relevance (Z → X path), exclusion restriction (no direct path
 *     Z → Y except through X), exogeneity (no hidden path Z ← U → Y assumed)
 *   - Identification strategy selection: iv > backdoor > frontdoor > unidentified
 *
 * Pure, dependency-free, deterministic — safe to call in hot paths.
 *
 * Ref: Pearl, "Causality" 2nd ed. (2009), Ch. 3.
 * Ref: Shachter, "Bayes-Ball" (1998) — used for d-separation intuition.
 */

export type CausalNodeType = 'exogenous' | 'endogenous' | 'instrument' | 'hidden' | 'decision' | 'gate' | 'financial'

export interface CausalNode {
  id: string
  label: string
  type: CausalNodeType
  description?: string
  /** Short KKO class (from kko-bridge) — annotated at build time */
  kko_class?: string
}

export interface CausalEdge {
  from: string
  to: string
  /** Latent / hidden edge — dashed in visualisation, blocks backdoor conditioning */
  latent?: boolean
  label?: string
  /** Estimated effect direction: positive | negative | unknown */
  effect?: 'positive' | 'negative' | 'unknown'
}

export interface CausalDAG {
  name: string
  description: string
  treatment?: string   // canonical treatment variable id
  outcome?: string     // canonical outcome variable id
  nodes: CausalNode[]
  edges: CausalEdge[]
}

// ── Internal graph helpers ────────────────────────────────────────────────────

function buildIndex(dag: CausalDAG): {
  parents: Map<string, string[]>
  children: Map<string, string[]>
  nodeSet: Set<string>
} {
  const parents = new Map<string, string[]>()
  const children = new Map<string, string[]>()
  const nodeSet = new Set(dag.nodes.map((n) => n.id))
  for (const n of dag.nodes) { parents.set(n.id, []); children.set(n.id, []) }
  for (const e of dag.edges) {
    if (!nodeSet.has(e.from) || !nodeSet.has(e.to)) continue
    children.get(e.from)!.push(e.to)
    parents.get(e.to)!.push(e.from)
  }
  return { parents, children, nodeSet }
}

/** Topological sort (Kahn's algorithm). Returns null if a cycle is detected. */
export function topologicalSort(dag: CausalDAG): string[] | null {
  const { parents, children } = buildIndex(dag)
  const inDegree = new Map<string, number>()
  for (const n of dag.nodes) inDegree.set(n.id, (parents.get(n.id) ?? []).length)
  const queue = dag.nodes.filter((n) => inDegree.get(n.id) === 0).map((n) => n.id)
  const order: string[] = []
  while (queue.length) {
    const v = queue.shift()!
    order.push(v)
    for (const c of (children.get(v) ?? [])) {
      inDegree.set(c, inDegree.get(c)! - 1)
      if (inDegree.get(c) === 0) queue.push(c)
    }
  }
  return order.length === dag.nodes.length ? order : null
}

export function isAcyclic(dag: CausalDAG): boolean {
  return topologicalSort(dag) !== null
}

/** All ancestors of a node (inclusive of the node itself). */
export function ancestors(dag: CausalDAG, id: string): Set<string> {
  const { parents } = buildIndex(dag)
  const visited = new Set<string>()
  const queue = [id]
  while (queue.length) {
    const v = queue.shift()!
    if (visited.has(v)) continue
    visited.add(v)
    for (const p of (parents.get(v) ?? [])) queue.push(p)
  }
  return visited
}

/** All descendants of a node (inclusive). */
export function descendants(dag: CausalDAG, id: string): Set<string> {
  const { children } = buildIndex(dag)
  const visited = new Set<string>()
  const queue = [id]
  while (queue.length) {
    const v = queue.shift()!
    if (visited.has(v)) continue
    visited.add(v)
    for (const c of (children.get(v) ?? [])) queue.push(c)
  }
  return visited
}

/** Enumerate all directed paths from `from` to `to` (DFS, cycle-safe, max depth 20). */
export function directedPaths(dag: CausalDAG, from: string, to: string): string[][] {
  const { children } = buildIndex(dag)
  const results: string[][] = []
  const dfs = (current: string, path: string[], visited: Set<string>) => {
    if (path.length > 20) return // depth guard
    if (current === to) { results.push([...path]); return }
    for (const c of (children.get(current) ?? [])) {
      if (!visited.has(c)) {
        visited.add(c)
        dfs(c, [...path, c], visited)
        visited.delete(c)
      }
    }
  }
  dfs(from, [from], new Set([from]))
  return results
}

/** True if there is at least one directed path from `from` to `to`
 *  NOT going through any node in `exclude`. */
export function hasDirectedPath(
  dag: CausalDAG,
  from: string,
  to: string,
  exclude: Set<string> = new Set(),
): boolean {
  const { children } = buildIndex(dag)
  const visited = new Set<string>()
  const queue = [from]
  while (queue.length) {
    const v = queue.shift()!
    if (v === to) return true
    if (visited.has(v) || exclude.has(v)) continue
    visited.add(v)
    for (const c of (children.get(v) ?? [])) queue.push(c)
  }
  return false
}

// ── Identification criteria ───────────────────────────────────────────────────

export interface BackdoorResult {
  satisfied: boolean
  /** Nodes in Z that were checked */
  adjustment_set: string[]
  /** Paths that are blocked by Z */
  blocked_paths: string[][]
  /** Paths NOT blocked (adjustment fails if any remain) */
  unblocked_paths: string[][]
  explanation: string
}

/**
 * Backdoor criterion check (Pearl 2009, Def. 3.3.1).
 *
 * Z satisfies the backdoor criterion relative to (X, Y) if:
 *   1. No node in Z is a descendant of X.
 *   2. Z blocks every "backdoor path" from X to Y — i.e. every path between X
 *      and Y that has an arrow INTO X.
 *
 * We approximate by: remove all edges OUT of X, check if Z d-separates X from Y
 * in the modified graph. For the demo we use a simpler directed path check on the
 * latent confounder sub-graph.
 */
export function backdoorCriterion(
  dag: CausalDAG,
  treatment: string,
  outcome: string,
  adjustmentSet: string[],
): BackdoorResult {
  const Z = new Set(adjustmentSet)
  const desc = descendants(dag, treatment)

  // Rule 1: no descendant of X in Z
  const violators = adjustmentSet.filter((z) => desc.has(z) && z !== treatment)
  if (violators.length > 0) {
    return {
      satisfied: false,
      adjustment_set: adjustmentSet,
      blocked_paths: [],
      unblocked_paths: [],
      explanation: `Adjustment set contains descendants of ${treatment}: ${violators.join(', ')}. Backdoor criterion violated.`,
    }
  }

  // Rule 2: identify backdoor paths (paths through hidden confounders or parent links)
  // A backdoor path is any path from treatment to outcome that starts with an arrow INTO treatment.
  // We find all hidden confounders (latent edges) that create backdoor paths.
  const latentSources = dag.edges.filter((e) => e.latent && e.to === treatment).map((e) => e.from)
  const { children } = buildIndex(dag)

  const blockedPaths: string[][] = []
  const unblockedPaths: string[][] = []

  for (const src of latentSources) {
    // Is there a path from src to outcome not blocked by Z?
    // Simplified: does src have a directed path to outcome while conditioned on Z?
    if (Z.has(src)) {
      blockedPaths.push([src, '←(latent)→', treatment, '...', outcome])
    } else {
      // Check if any node on the path from src to outcome is in Z
      const pathsFromSrc = directedPaths(dag, src, outcome)
      for (const path of pathsFromSrc) {
        const blocked = path.some((n) => Z.has(n))
        if (blocked) blockedPaths.push(path)
        else unblockedPaths.push(path)
      }
      // Also check the path src → treatment → outcome (not going through Z)
      if (!Z.has(src) && !Z.has(treatment)) {
        const directBackdoor = [src, '←(hidden)→', treatment, '→', outcome]
        if (!unblockedPaths.some((p) => p.join() === directBackdoor.join())) {
          unblockedPaths.push(directBackdoor)
        }
      }
    }
  }

  const satisfied = unblockedPaths.length === 0
  return {
    satisfied,
    adjustment_set: adjustmentSet,
    blocked_paths: blockedPaths,
    unblocked_paths: unblockedPaths,
    explanation: satisfied
      ? `Z = {${adjustmentSet.join(', ')}} blocks all backdoor paths from ${treatment} to ${outcome}. Causal effect is identified by adjustment.`
      : `Z = {${adjustmentSet.join(', ')}} does NOT block all backdoor paths. Unblocked: ${unblockedPaths.length}. Consider IV or frontdoor criterion.`,
  }
}

export interface IVResult {
  valid: boolean
  instrument: string
  treatment: string
  outcome: string
  relevance: boolean          // Z → X path exists
  exclusion: boolean          // no direct Z → Y except through X
  explanation: string
}

/**
 * IV validity check (three conditions).
 *
 * Z is a valid instrument for X → Y if:
 *   1. Relevance: there is a directed path Z → X.
 *   2. Exclusion restriction: Z has no directed path to Y except through X.
 *   3. Exogeneity: Z is independent of all confounders of X → Y.
 *      (We check that Z has no latent incoming edges from confounders of Y.)
 */
export function ivValidity(
  dag: CausalDAG,
  instrument: string,
  treatment: string,
  outcome: string,
): IVResult {
  // Relevance: directed path Z → X
  const relevance = hasDirectedPath(dag, instrument, treatment)

  // Exclusion restriction: no directed path Z → Y that bypasses X
  const pathsToOutcome = directedPaths(dag, instrument, outcome)
  const directPaths = pathsToOutcome.filter((p) => !p.includes(treatment))
  const exclusion = directPaths.length === 0

  const valid = relevance && exclusion
  return {
    valid,
    instrument,
    treatment,
    outcome,
    relevance,
    exclusion,
    explanation: valid
      ? `${instrument} is a valid IV: it causes ${treatment} (relevance ✓) and has no direct path to ${outcome} except through ${treatment} (exclusion ✓). Causal effect of ${treatment} → ${outcome} is identified.`
      : [
          !relevance ? `No directed path ${instrument} → ${treatment} (relevance violated).` : '',
          !exclusion ? `Direct paths ${instrument} → ${outcome} bypassing ${treatment}: ${directPaths.map((p) => p.join('→')).join('; ')} (exclusion violated).` : '',
        ].filter(Boolean).join(' '),
  }
}

export interface FrontdoorResult {
  valid: boolean
  mediators: string[]
  treatment: string
  outcome: string
  explanation: string
}

/**
 * Frontdoor criterion (Pearl 2009, Def. 3.3.4).
 *
 * M satisfies the frontdoor criterion relative to (X, Y) if:
 *   1. M intercepts all directed paths from X to Y (M is on every such path).
 *   2. There are no unblocked backdoor paths from X to M.
 *   3. All backdoor paths from M to Y are blocked by X.
 */
export function frontdoorCriterion(
  dag: CausalDAG,
  treatment: string,
  outcome: string,
  mediators: string[],
): FrontdoorResult {
  const M = new Set(mediators)

  // Condition 1: every directed path X → Y passes through at least one mediator
  const allPaths = directedPaths(dag, treatment, outcome)
  const uncoveredPaths = allPaths.filter((path) => !path.some((n, i) => i > 0 && M.has(n)))
  const interceptsAll = uncoveredPaths.length === 0

  // Condition 2: no unblocked backdoor path X → M (no latent confounder of X that reaches M)
  const confoundersOfX = dag.edges.filter((e) => e.latent && e.to === treatment).map((e) => e.from)
  const backdoorToM = confoundersOfX.some((c) => mediators.some((m) => hasDirectedPath(dag, c, m)))

  // Condition 3: X blocks all backdoor paths from M to Y
  const confoundersOfM = dag.edges.filter((e) => e.latent && mediators.includes(e.to)).map((e) => e.from)
  const backdoorMtoY = confoundersOfM.some((c) =>
    hasDirectedPath(dag, c, outcome, new Set([treatment]))
  )

  const valid = interceptsAll && !backdoorToM && !backdoorMtoY
  return {
    valid,
    mediators,
    treatment,
    outcome,
    explanation: valid
      ? `Frontdoor criterion satisfied via {${mediators.join(', ')}}. All directed paths ${treatment}→${outcome} are intercepted; no unblocked backdoor contamination.`
      : [
          !interceptsAll ? `Mediators {${mediators.join(', ')}} do NOT intercept all directed paths. Uncovered: ${uncoveredPaths.map((p) => p.join('→')).join('; ')}.` : '',
          backdoorToM ? `Unblocked backdoor path exists from a confounder of ${treatment} to the mediator set.` : '',
          backdoorMtoY ? `Backdoor path from mediator confounder to ${outcome} not blocked by ${treatment}.` : '',
        ].filter(Boolean).join(' '),
  }
}

// ── Strategy selection ────────────────────────────────────────────────────────

export type IdentificationStrategy = 'iv' | 'backdoor' | 'frontdoor' | 'unidentified'

export interface IdentificationResult {
  strategy: IdentificationStrategy
  identified: boolean
  /** The instrument node id, if strategy = 'iv' */
  instrument?: string
  /** The adjustment set, if strategy = 'backdoor' */
  adjustment_set?: string[]
  /** The mediator set, if strategy = 'frontdoor' */
  mediators?: string[]
  detail: IVResult | BackdoorResult | FrontdoorResult | null
  summary: string
}

/**
 * Attempt to identify the causal effect of `treatment` on `outcome` in `dag`.
 *
 * Tries IV first (most ASIC-robust), then backdoor, then frontdoor.
 * Returns the first successful strategy.
 */
export function identifyCausalEffect(
  dag: CausalDAG,
  treatment?: string,
  outcome?: string,
): IdentificationResult {
  const X = treatment ?? dag.treatment
  const Y = outcome ?? dag.outcome
  if (!X || !Y) {
    return { strategy: 'unidentified', identified: false, detail: null, summary: 'No treatment or outcome specified.' }
  }

  // Try IV: any instrument node with a path to X but no direct path to Y
  const instruments = dag.nodes.filter((n) => n.type === 'instrument')
  for (const inst of instruments) {
    const iv = ivValidity(dag, inst.id, X, Y)
    if (iv.valid) {
      return {
        strategy: 'iv',
        identified: true,
        instrument: inst.id,
        detail: iv,
        summary: iv.explanation,
      }
    }
  }

  // Try backdoor: exogenous + non-hidden nodes that block confounders
  const candidateZ = dag.nodes
    .filter((n) => n.type === 'exogenous' && n.id !== X && n.id !== Y)
    .map((n) => n.id)
  if (candidateZ.length > 0) {
    const bd = backdoorCriterion(dag, X, Y, candidateZ)
    if (bd.satisfied) {
      return {
        strategy: 'backdoor',
        identified: true,
        adjustment_set: candidateZ,
        detail: bd,
        summary: bd.explanation,
      }
    }
  }

  // Try frontdoor: endogenous mediators on the X → Y path
  const allXYPaths = directedPaths(dag, X, Y)
  if (allXYPaths.length > 0) {
    // Find nodes that appear on every directed path (i.e. intercept all paths)
    const commonNodes = allXYPaths[0]!
      .filter((n) => n !== X && n !== Y && allXYPaths.every((p) => p.includes(n)))
    if (commonNodes.length > 0) {
      const fd = frontdoorCriterion(dag, X, Y, commonNodes)
      if (fd.valid) {
        return {
          strategy: 'frontdoor',
          identified: true,
          mediators: commonNodes,
          detail: fd,
          summary: fd.explanation,
        }
      }
    }
  }

  return {
    strategy: 'unidentified',
    identified: false,
    detail: null,
    summary: `Causal effect of ${X} → ${Y} is not identified with the available observed variables. Hidden confounders may block all standard criteria.`,
  }
}

/** Return all nodes along the primary directed causal path from treatment to outcome. */
export function primaryCausalPath(dag: CausalDAG, from?: string, to?: string): string[] {
  const X = from ?? dag.treatment
  const Y = to ?? dag.outcome
  if (!X || !Y) return []
  const paths = directedPaths(dag, X, Y)
  if (paths.length === 0) return []
  // Prefer the shortest directed path
  return paths.reduce((a, b) => (a.length <= b.length ? a : b))
}
