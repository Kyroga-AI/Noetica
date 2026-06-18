/**
 * CairnPath AtomSpace Adapter — CairnPath traversal protocol over HellGraph.
 *
 * Implements the CairnPath contract (github.com/SocioProphet/cairnpath-mesh)
 * with engine="atomspace". The invariant after every hop:
 *   1. candidates = EXPAND(frontier, args)   ← outgoing + incoming links
 *   2. candidates = DEDUP(candidates)         ← handle identity
 *   3. candidates = RANK(candidates)          ← ECAN STI (metadata-only)
 *   4. frontier   = CAP(candidates, K)        ← hard frontier cap
 *
 * Routes:
 *   POST /api/cairnpath/line              — create CairnLine (Context + initial frontier)
 *   POST /api/cairnpath/line/:id/step     — execute one step (opcode + args)
 *   GET  /api/cairnpath/line/:id          — full line with steps + results
 *   GET  /api/cairnpath/lines             — list all lines
 *   POST /api/cairnpath/line/:id/branch   — branch line at current frontier
 *
 * AtomID URI: atomspace://<handle>  (per export context pack §17 P0)
 */

import * as http from 'node:http'
import * as crypto from 'node:crypto'
import type { AtomSpace, Atom, Handle } from '../../lib/hellgraph/atomspace.js'

// ─── Schema types (mirrors cairnpath-mesh schemas exactly) ────────────────────

export interface CairnFrontier {
  ordered: string[]
  dedup_set_hash: string
  cap_k: number
  dedup_strategy?: 'identity' | 'canonical_equivalence'
  stable_order?: 'rank_then_lex' | 'lexicographic'
}

export interface CairnConstraints {
  allowed_relations?: string[]
  allowed_predicates?: string[]
  allowed_namespaces?: string[]
  max_hops?: number
  max_materialize_bytes?: number
  cost_budget?: { max_ms?: number; max_rows?: number }
}

export interface CairnContext {
  context_id: string
  engine: 'atomspace'
  engine_ref?: string
  dataset_ref: string
  seed_entities: string[]
  frontier: CairnFrontier
  constraints: CairnConstraints
  bindings?: Record<string, unknown>
  created_at: string
}

export interface CairnStepArgs {
  dir?: 'out' | 'in' | 'both'
  max_level?: number
  relationship_filter?: string
  predicate_filter?: string
  terminators?: string[]
  bfs?: boolean
  limit?: number
  rank_policy_id?: string
  cap_k?: number
  dedup_strategy?: 'identity' | 'canonical_equivalence'
  lazy?: boolean
}

export interface CairnMetrics {
  fanout: number
  dedup_ratio: number
  cap_hit: boolean
  elapsed_ms: number
  db_hits?: number
  materialized_bytes?: number
}

export interface CairnStep {
  step_id: string
  line_id: string
  index: number
  opcode: 'expand' | 'optional_expand' | 'sequence_expand' | 'filter' | 'rank' | 'dedup' | 'cap' | 'materialize' | 'commit_view'
  args: CairnStepArgs
  in_context_id: string
  out_context_id: string
  metrics: CairnMetrics
  created_at: string
  notes?: string
}

export interface CairnResult {
  line_id: string
  step_id: string
  frontier: string[]
  supporting_refs: string[]
  computed_at: string
  equivalence_map?: Record<string, string>
  warnings?: string[]
}

export interface CairnLine {
  line_id: string
  root_context_id: string
  steps: string[]
  status: 'draft' | 'running' | 'complete' | 'failed' | 'branched'
  created_at: string
  updated_at: string
  branch_of?: string
  description?: string
  tags?: string[]
}

// ─── Default policy (CairnLimits) ─────────────────────────────────────────────

const DEFAULT_POLICY = {
  policy_id: 'atomspace-default-v0',
  default_cap_k: 50,
  max_cap_k: 500,
  max_hops: 10,
  max_materialize_bytes: 10_000_000,  // 10 MB
  max_elapsed_ms: 30_000,
  allowed_opcodes: ['expand', 'optional_expand', 'sequence_expand', 'filter', 'rank', 'dedup', 'cap', 'materialize', 'commit_view'],
} as const

// ─── In-process registry ──────────────────────────────────────────────────────

interface LineRuntime {
  line: CairnLine
  contexts: Map<string, CairnContext>
  steps: Map<string, CairnStep>
  results: Map<string, CairnResult>
  currentFrontier: Handle[]
  hops: number
}

const _lines = new Map<string, LineRuntime>()

// ─── Helpers ──────────────────────────────────────────────────────────────────

function atomUri(handle: Handle): string {
  return `atomspace://${handle}`
}

function dedupSetHash(handles: string[]): string {
  const sorted = [...handles].sort().join('\n')
  return crypto.createHash('sha256').update(sorted).digest('hex')
}

function newContextId(): string { return crypto.randomUUID() }
function newStepId(): string    { return crypto.randomUUID() }
function newLineId(): string    { return crypto.randomUUID() }

function makeFrontier(ordered: string[], cap_k: number): CairnFrontier {
  return { ordered, dedup_set_hash: dedupSetHash(ordered), cap_k }
}

// ─── Core traversal ops ───────────────────────────────────────────────────────

/** One-hop expand: outgoing + incoming neighbors of all frontier atoms. */
function expandFrontier(space: AtomSpace, frontier: Handle[], args: CairnStepArgs): Handle[] {
  const dir = args.dir ?? 'both'
  const candidates: Handle[] = []
  const relFilter = args.relationship_filter
  const predFilter = args.predicate_filter

  for (const handle of frontier) {
    const atom = space.getAtom(handle)
    if (!atom) continue

    if (dir === 'out' || dir === 'both') {
      for (const target of atom.outgoing ?? []) {
        if (relFilter && !matchTypeFilter(space.getAtom(target), relFilter)) continue
        candidates.push(target)
      }
    }

    if (dir === 'in' || dir === 'both') {
      for (const link of space.getIncoming(handle)) {
        if (relFilter && !matchTypeFilter(link, relFilter)) continue
        if (predFilter && !matchTypeFilter(link, predFilter)) continue
        candidates.push(link.handle)
        // also expand to the other outgoing members of incoming links
        for (const t of link.outgoing ?? []) {
          if (t !== handle) candidates.push(t)
        }
      }
    }
  }

  return candidates
}

function matchTypeFilter(atom: Atom | undefined, filter: string): boolean {
  if (!atom) return false
  return atom.type.toLowerCase().includes(filter.toLowerCase()) ||
    (atom.name ?? '').toLowerCase().includes(filter.toLowerCase())
}

/** Dedup: handle identity (default) or canonical name equivalence. */
function dedupHandles(handles: Handle[], strategy: 'identity' | 'canonical_equivalence', space: AtomSpace): Handle[] {
  if (strategy === 'canonical_equivalence') {
    const seen = new Map<string, Handle>()
    for (const h of handles) {
      const atom = space.getAtom(h)
      const key = atom ? `${atom.type}:${atom.name ?? h}` : h
      if (!seen.has(key)) seen.set(key, h)
    }
    return Array.from(seen.values())
  }
  // identity: just deduplicate by handle string
  return [...new Set(handles)]
}

/** Rank by ECAN STI (pre-materialize). Other policies: lti, tv_confidence. */
function rankHandles(handles: Handle[], policyId: string, space: AtomSpace): Handle[] {
  const sorted = [...handles]
  sorted.sort((a, b) => {
    const atomA = space.getAtom(a)
    const atomB = space.getAtom(b)
    if (policyId === 'ecan_lti') {
      return (atomB?.av?.lti ?? 0) - (atomA?.av?.lti ?? 0)
    }
    if (policyId === 'tv_confidence') {
      return (atomB?.tv?.confidence ?? 0) - (atomA?.tv?.confidence ?? 0)
    }
    if (policyId === 'tv_strength') {
      return (atomB?.tv?.strength ?? 0) - (atomA?.tv?.strength ?? 0)
    }
    // default: ecan_sti
    return (atomB?.av?.sti ?? 0) - (atomA?.av?.sti ?? 0)
  })
  return sorted
}

/** Full CairnPath expand invariant: EXPAND → DEDUP → RANK → CAP */
function expandInvariant(
  space: AtomSpace,
  frontier: Handle[],
  args: CairnStepArgs,
  capK: number,
): { result: Handle[]; metrics: CairnMetrics } {
  const t0 = Date.now()

  const expanded = expandFrontier(space, frontier, args)
  const fanout = expanded.length

  const strategy = args.dedup_strategy ?? 'identity'
  const deduped = dedupHandles(expanded, strategy, space)
  const dedup_ratio = fanout > 0 ? (fanout - deduped.length) / fanout : 0

  const ranked = rankHandles(deduped, args.rank_policy_id ?? 'ecan_sti', space)
  const capped = ranked.slice(0, capK)
  const cap_hit = ranked.length > capK

  return {
    result: capped,
    metrics: { fanout, dedup_ratio, cap_hit, elapsed_ms: Date.now() - t0, db_hits: fanout },
  }
}

// ─── Line creation ────────────────────────────────────────────────────────────

function createLine(
  space: AtomSpace,
  seeds: Handle[],
  cap_k: number,
  constraints: CairnConstraints,
  opts: { description?: string; tags?: string[] } = {},
): LineRuntime {
  const now = new Date().toISOString()
  const context_id = newContextId()
  const line_id = newLineId()

  // Seed entities become the initial frontier (they must exist in the space)
  const validSeeds = seeds.filter(h => space.getAtom(h))
  const initialFrontier = makeFrontier(validSeeds, cap_k)

  const rootContext: CairnContext = {
    context_id,
    engine: 'atomspace',
    engine_ref: space.id,
    dataset_ref: `atomspace:${space.id}@seq${space.logicalClock}`,
    seed_entities: validSeeds,
    frontier: initialFrontier,
    constraints,
    created_at: now,
  }

  const line: CairnLine = {
    line_id,
    root_context_id: context_id,
    steps: [],
    status: 'draft',
    created_at: now,
    updated_at: now,
    description: opts.description,
    tags: opts.tags,
  }

  const runtime: LineRuntime = {
    line,
    contexts: new Map([[context_id, rootContext]]),
    steps: new Map(),
    results: new Map(),
    currentFrontier: validSeeds,
    hops: 0,
  }

  _lines.set(line_id, runtime)
  return runtime
}

// ─── Step execution ───────────────────────────────────────────────────────────

interface StepOutcome {
  step: CairnStep
  result: CairnResult
  warnings: string[]
}

function executeStep(
  space: AtomSpace,
  rt: LineRuntime,
  opcode: CairnStep['opcode'],
  args: CairnStepArgs,
): StepOutcome {
  const t0 = Date.now()
  const now = new Date().toISOString()
  const step_id = newStepId()
  const in_context_id = rt.line.steps.length > 0
    ? rt.steps.get(rt.line.steps.at(-1)!)!.out_context_id
    : rt.line.root_context_id
  const out_context_id = newContextId()
  const rootCtx = rt.contexts.get(rt.line.root_context_id)!
  const cap_k = args.cap_k ?? rootCtx.frontier.cap_k ?? DEFAULT_POLICY.default_cap_k
  const stepIndex = rt.line.steps.length
  const warnings: string[] = []

  let newFrontier = rt.currentFrontier
  let metrics: CairnMetrics = { fanout: 0, dedup_ratio: 0, cap_hit: false, elapsed_ms: 0 }

  // Policy checks
  if (rt.hops >= DEFAULT_POLICY.max_hops) warnings.push('max_hops reached')
  if (rootCtx.constraints.max_hops && rt.hops >= rootCtx.constraints.max_hops) {
    warnings.push('context max_hops reached')
  }

  switch (opcode) {
    case 'expand':
    case 'optional_expand': {
      const { result, metrics: m } = expandInvariant(space, rt.currentFrontier, args, cap_k)
      if (result.length === 0 && opcode === 'optional_expand') {
        // preserve frontier, just record empty expansion
        newFrontier = rt.currentFrontier
        warnings.push('optional_expand: no candidates, frontier preserved')
      } else {
        newFrontier = result
      }
      metrics = m
      rt.hops++
      break
    }

    case 'filter': {
      const filter = args.relationship_filter ?? args.predicate_filter ?? ''
      const before = rt.currentFrontier.length
      newFrontier = rt.currentFrontier.filter(h => {
        const atom = space.getAtom(h)
        return !filter || matchTypeFilter(atom, filter)
      })
      metrics = {
        fanout: before,
        dedup_ratio: 0,
        cap_hit: false,
        elapsed_ms: Date.now() - t0,
        db_hits: before,
      }
      break
    }

    case 'rank': {
      const before = rt.currentFrontier.length
      newFrontier = rankHandles(rt.currentFrontier, args.rank_policy_id ?? 'ecan_sti', space)
      metrics = { fanout: before, dedup_ratio: 0, cap_hit: false, elapsed_ms: Date.now() - t0 }
      break
    }

    case 'dedup': {
      const before = rt.currentFrontier.length
      newFrontier = dedupHandles(rt.currentFrontier, args.dedup_strategy ?? 'identity', space)
      const removed = before - newFrontier.length
      metrics = {
        fanout: before,
        dedup_ratio: before > 0 ? removed / before : 0,
        cap_hit: false,
        elapsed_ms: Date.now() - t0,
      }
      break
    }

    case 'cap': {
      const k = args.cap_k ?? cap_k
      const before = rt.currentFrontier.length
      newFrontier = rt.currentFrontier.slice(0, k)
      metrics = { fanout: before, dedup_ratio: 0, cap_hit: before > k, elapsed_ms: Date.now() - t0 }
      break
    }

    case 'materialize': {
      // Hydrate atoms (no frontier change, but db_hits = atoms fetched)
      let bytes = 0
      let hits = 0
      for (const h of rt.currentFrontier) {
        const atom = space.getAtom(h)
        if (atom) { bytes += JSON.stringify(atom).length; hits++ }
      }
      newFrontier = rt.currentFrontier
      metrics = {
        fanout: rt.currentFrontier.length,
        dedup_ratio: 0,
        cap_hit: false,
        elapsed_ms: Date.now() - t0,
        db_hits: hits,
        materialized_bytes: bytes,
      }
      if (rootCtx.constraints.max_materialize_bytes && bytes > rootCtx.constraints.max_materialize_bytes) {
        warnings.push(`materialized_bytes ${bytes} exceeds constraint ${rootCtx.constraints.max_materialize_bytes}`)
      }
      break
    }

    case 'commit_view': {
      rt.line.status = 'complete'
      newFrontier = rt.currentFrontier
      metrics = { fanout: rt.currentFrontier.length, dedup_ratio: 0, cap_hit: false, elapsed_ms: Date.now() - t0 }
      break
    }

    default:
      warnings.push(`unknown opcode: ${opcode as string}`)
      newFrontier = rt.currentFrontier
      metrics = { fanout: 0, dedup_ratio: 0, cap_hit: false, elapsed_ms: 0 }
  }

  // Build out Context capturing new frontier state
  const outContext: CairnContext = {
    ...rootCtx,
    context_id: out_context_id,
    frontier: makeFrontier(newFrontier, cap_k),
    created_at: now,
  }
  rt.contexts.set(out_context_id, outContext)
  rt.currentFrontier = newFrontier

  const step: CairnStep = {
    step_id,
    line_id: rt.line.line_id,
    index: stepIndex,
    opcode,
    args,
    in_context_id,
    out_context_id,
    metrics: { ...metrics, elapsed_ms: Date.now() - t0 },
    created_at: now,
  }

  const result: CairnResult = {
    line_id: rt.line.line_id,
    step_id,
    frontier: newFrontier,
    supporting_refs: newFrontier.map(atomUri),
    computed_at: now,
    warnings: warnings.length > 0 ? warnings : undefined,
  }

  rt.steps.set(step_id, step)
  rt.results.set(step_id, result)
  rt.line.steps.push(step_id)
  rt.line.updated_at = now
  if (rt.line.status === 'draft') rt.line.status = 'running'

  return { step, result, warnings }
}

// ─── HTTP route handler ───────────────────────────────────────────────────────

export function handleCairnPathRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  pathname: string,
  space: AtomSpace,
): boolean {
  if (!pathname.startsWith('/api/cairnpath')) return false

  const setCORS = () => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'content-type, authorization')
  }

  if (req.method === 'OPTIONS') { setCORS(); res.writeHead(204); res.end(); return true }

  // GET /api/cairnpath/lines
  if (req.method === 'GET' && pathname === '/api/cairnpath/lines') {
    setCORS()
    const list = Array.from(_lines.values()).map(rt => ({
      ...rt.line,
      step_count: rt.line.steps.length,
      frontier_size: rt.currentFrontier.length,
    }))
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ lines: list, count: list.length }))
    return true
  }

  // GET /api/cairnpath/policy
  if (req.method === 'GET' && pathname === '/api/cairnpath/policy') {
    setCORS()
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify(DEFAULT_POLICY))
    return true
  }

  // POST /api/cairnpath/line  — create CairnLine
  if (req.method === 'POST' && pathname === '/api/cairnpath/line') {
    setCORS()
    readBody(req).then((body) => {
      try {
        const req_ = JSON.parse(body) as {
          seed_entities: string[]
          cap_k?: number
          constraints?: CairnConstraints
          description?: string
          tags?: string[]
        }
        if (!Array.isArray(req_.seed_entities) || req_.seed_entities.length === 0) {
          throw new Error('seed_entities required')
        }
        const cap_k = Math.min(req_.cap_k ?? DEFAULT_POLICY.default_cap_k, DEFAULT_POLICY.max_cap_k)
        const rt = createLine(space, req_.seed_entities, cap_k, req_.constraints ?? {}, {
          description: req_.description,
          tags: req_.tags,
        })
        const rootCtx = rt.contexts.get(rt.line.root_context_id)!
        res.writeHead(201, { 'content-type': 'application/json' })
        res.end(JSON.stringify({
          line_id: rt.line.line_id,
          context_id: rt.line.root_context_id,
          frontier: rootCtx.frontier,
          dataset_ref: rootCtx.dataset_ref,
          status: rt.line.status,
        }))
      } catch (e) {
        res.writeHead(400, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: String(e) }))
      }
    }).catch(() => { res.writeHead(500); res.end() })
    return true
  }

  // GET /api/cairnpath/line/:id
  const lineGetMatch = pathname.match(/^\/api\/cairnpath\/line\/([^/]+)$/)
  if (req.method === 'GET' && lineGetMatch) {
    setCORS()
    const rt = _lines.get(lineGetMatch[1]!)
    if (!rt) {
      res.writeHead(404, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'line_not_found' }))
    } else {
      const steps = rt.line.steps.map(sid => ({
        step: rt.steps.get(sid),
        result: rt.results.get(sid),
      }))
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({
        line: rt.line,
        root_context: rt.contexts.get(rt.line.root_context_id),
        steps,
        current_frontier: rt.currentFrontier,
        frontier_size: rt.currentFrontier.length,
        hops: rt.hops,
      }))
    }
    return true
  }

  // POST /api/cairnpath/line/:id/step
  const stepMatch = pathname.match(/^\/api\/cairnpath\/line\/([^/]+)\/step$/)
  if (req.method === 'POST' && stepMatch) {
    setCORS()
    readBody(req).then((body) => {
      try {
        const rt = _lines.get(stepMatch[1]!)
        if (!rt) throw new Error('line_not_found')
        if (rt.line.status === 'complete' || rt.line.status === 'failed') {
          throw new Error(`line_${rt.line.status}: cannot add steps`)
        }

        const req_ = JSON.parse(body) as { opcode: CairnStep['opcode']; args?: CairnStepArgs; notes?: string }
        if (!req_.opcode) throw new Error('opcode required')
        if (!DEFAULT_POLICY.allowed_opcodes.includes(req_.opcode)) {
          throw new Error(`opcode not allowed: ${req_.opcode}`)
        }

        const { step, result, warnings } = executeStep(space, rt, req_.opcode, req_.args ?? {})
        if (req_.notes) step.notes = req_.notes

        res.writeHead(201, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ step, result, warnings, line_status: rt.line.status }))
      } catch (e) {
        res.writeHead(400, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: String(e) }))
      }
    }).catch(() => { res.writeHead(500); res.end() })
    return true
  }

  // POST /api/cairnpath/line/:id/branch  — branch line at current frontier
  const branchMatch = pathname.match(/^\/api\/cairnpath\/line\/([^/]+)\/branch$/)
  if (req.method === 'POST' && branchMatch) {
    setCORS()
    readBody(req).then((body) => {
      try {
        const parentRt = _lines.get(branchMatch[1]!)
        if (!parentRt) throw new Error('line_not_found')

        const req_ = JSON.parse(body) as { description?: string; tags?: string[] }
        const now = new Date().toISOString()
        const line_id = newLineId()

        // Clone current state: same frontier, fresh step history
        const branchLine: CairnLine = {
          line_id,
          root_context_id: parentRt.line.root_context_id,
          steps: [],
          status: 'draft',
          created_at: now,
          updated_at: now,
          branch_of: parentRt.line.line_id,
          description: req_.description,
          tags: req_.tags,
        }

        const branchRt: LineRuntime = {
          line: branchLine,
          contexts: new Map(parentRt.contexts),
          steps: new Map(),
          results: new Map(),
          currentFrontier: [...parentRt.currentFrontier],
          hops: parentRt.hops,
        }

        _lines.set(line_id, branchRt)
        parentRt.line.status = 'branched'
        parentRt.line.updated_at = now

        const rootCtx = branchRt.contexts.get(branchRt.line.root_context_id)!
        res.writeHead(201, { 'content-type': 'application/json' })
        res.end(JSON.stringify({
          line_id,
          branch_of: parentRt.line.line_id,
          frontier: rootCtx.frontier,
          status: branchLine.status,
        }))
      } catch (e) {
        res.writeHead(400, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: String(e) }))
      }
    }).catch(() => { res.writeHead(500); res.end() })
    return true
  }

  // GET /api/cairnpath/line/:id/frontier  — current frontier atoms (materialized)
  const frontierMatch = pathname.match(/^\/api\/cairnpath\/line\/([^/]+)\/frontier$/)
  if (req.method === 'GET' && frontierMatch) {
    setCORS()
    const rt = _lines.get(frontierMatch[1]!)
    if (!rt) {
      res.writeHead(404, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'line_not_found' }))
    } else {
      const atoms = rt.currentFrontier.map(h => space.getAtom(h)).filter(Boolean)
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({
        line_id: rt.line.line_id,
        frontier: rt.currentFrontier,
        atoms,
        count: rt.currentFrontier.length,
        hops: rt.hops,
      }))
    }
    return true
  }

  return false
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let d = ''
    req.on('data', (c: Buffer) => { d += c.toString() })
    req.on('end', () => resolve(d))
    req.on('error', reject)
  })
}

// ─── Direct API (for MeshRush bridge integration) ─────────────────────────────

export { createLine as cairnCreateLine, executeStep as cairnExecuteStep, expandInvariant }
export type { LineRuntime as CairnLineRuntime }
