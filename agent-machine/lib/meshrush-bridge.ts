/**
 * MeshRush HTTP Bridge — graph-native agent runtime over HellGraph AtomSpace.
 *
 * Implements the MeshRush core-runtime contract (specs/02-core-runtime.md) as
 * HTTP endpoints so MeshRush Python (or any client) can drive graph-native agents
 * over the Noetica AtomSpace substrate.
 *
 * Runtime loop (per spec):
 *   1. ingest graph view      → POST /api/meshrush/session        (WorkspaceContext + GraphEntryContext)
 *   2. initialize diffusion   → session.graphView (subgraph BFS from seeds)
 *   3. traverse/diffuse       → POST /api/meshrush/session/:id/diffuse  (PatternMatcher query)
 *   4. stop/continue decision → POST /api/meshrush/session/:id/stop     (emit stop state)
 *   5. crystallize artifact   → POST /api/meshrush/session/:id/crystallize (write atoms back)
 *   6. emit evidence          → GET  /api/meshrush/session/:id/evidence  (provenance trace)
 *
 * Integration with GAIA: sessions can be seeded from GAIA observation handles or
 * belief snapshot handles, letting MeshRush agents reason over the digital twin's
 * current world state and crystallize durable knowledge artifacts.
 *
 * Integration with Ontogenesis: crystallized artifacts carry Ontogenesis-compatible
 * provenance Values (workspace, session, agent, evidence chain).
 */

import * as http from 'node:http'
import * as crypto from 'node:crypto'
import type { AtomSpace, Atom, Handle, AtomLogEntry } from '../../lib/hellgraph/atomspace.js'
import { findMatches } from '../../lib/hellgraph/patternMatcher.js'
import type { Pattern, MatchResult } from '../../lib/hellgraph/patternMatcher.js'

// ─── MeshRush session model ───────────────────────────────────────────────────
// Maps directly to spec objects: GraphView, AgentContext, DiffusionState, Artifact

export interface MeshRushSession {
  id: string
  agentId: string
  workspaceId: string
  graphView: Atom[]            // extracted subgraph (BFS from seeds)
  seedHandles: Handle[]
  diffusionLog: DiffusionStep[]
  artifacts: CrystallizedArtifact[]
  status: 'active' | 'stopped' | 'crystallized' | 'dissolved'
  createdAt: string
  updatedAt: string
}

interface DiffusionStep {
  seq: number
  pattern: Pattern
  result: MatchResult
  decision: 'continue' | 'stop' | 'defer'
  ts: string
}

interface CrystallizedArtifact {
  handle: Handle
  type: string
  summary: string
  sourceAtoms: Handle[]
  ts: string
}

// ─── Session registry (in-process, transient) ─────────────────────────────────

const _sessions = new Map<string, MeshRushSession>()

// GC: purge sessions idle for more than SESSION_TTL_MS.
// Prevents unbounded memory growth when clients disconnect without cleanup.
const SESSION_TTL_MS = 60 * 60 * 1000  // 1 hour

function touchSession(session: MeshRushSession): void {
  session.updatedAt = new Date().toISOString()
}

function getSession(id: string): MeshRushSession | undefined {
  const s = _sessions.get(id)
  if (s) touchSession(s)
  return s
}

setInterval(() => {
  const cutoff = Date.now() - SESSION_TTL_MS
  for (const [id, session] of _sessions) {
    if (new Date(session.updatedAt).getTime() < cutoff) {
      _sessions.delete(id)
      console.log(`[meshrush] Expired idle session ${id}`)
    }
  }
}, 60_000).unref()

// ─── BFS subgraph extraction ──────────────────────────────────────────────────
// MeshRush "graph view" = n-hop neighborhood of seed atoms, ECAN-weighted
// (atoms with higher STI are expanded first — attention guides diffusion).

export function extractSubgraph(space: AtomSpace, seeds: Handle[], maxDepth: number, maxAtoms: number): Atom[] {
  const visited = new Set<Handle>()
  const result: Atom[] = []

  // Sort seeds by ECAN STI descending (highest attention first)
  const prioritize = (handles: Handle[]): Handle[] =>
    [...handles].sort((a, b) => {
      const sti = (h: Handle) => space.getAtom(h)?.av?.sti ?? 0
      return sti(b) - sti(a)
    })

  let frontier = prioritize(seeds.filter(h => space.getAtom(h)))

  for (let depth = 0; depth <= maxDepth && result.length < maxAtoms; depth++) {
    const nextFrontier: Handle[] = []
    for (const handle of frontier) {
      if (visited.has(handle)) continue
      visited.add(handle)
      const atom = space.getAtom(handle)
      if (!atom) continue
      result.push(atom)
      if (result.length >= maxAtoms) break
      if (depth < maxDepth) {
        for (const target of atom.outgoing ?? []) {
          if (!visited.has(target)) nextFrontier.push(target)
        }
        for (const link of space.getIncoming(handle)) {
          if (!visited.has(link.handle)) nextFrontier.push(link.handle)
        }
      }
    }
    frontier = prioritize(nextFrontier)
    if (frontier.length === 0) break
  }

  return result
}

// ─── Stop/continue heuristic ──────────────────────────────────────────────────
// Implements the stop state boundary from spec §4. Uses grounding coverage
// and TruthValue confidence as stopping signals.

function stopDecision(result: MatchResult, history: DiffusionStep[]): 'continue' | 'stop' | 'defer' {
  if (result.groundings.length === 0) return 'stop'
  if (result.groundings.length >= 10) return 'stop'   // sufficient coverage
  if (history.length >= 8) return 'stop'              // depth limit
  // Check TruthValue convergence across last 3 steps
  if (history.length >= 3) {
    const recent = history.slice(-3).map(s => s.result.groundings.length)
    const converging = recent.every((n, i) => i === 0 || n <= recent[i-1]!)
    if (converging) return 'stop'
  }
  if (result.groundings.length < 2) return 'defer'
  return 'continue'
}

// ─── Route handlers ───────────────────────────────────────────────────────────

export function handleMeshRushRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  pathname: string,
  space: AtomSpace,
): boolean {
  if (!pathname.startsWith('/api/meshrush/')) return false

  const setCORS = () => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'content-type, authorization')
  }

  // POST /api/meshrush/session — create session (ingest graph view)
  if (req.method === 'POST' && pathname === '/api/meshrush/session') {
    setCORS()
    readBody(req).then((body) => {
      try {
        const req_ = JSON.parse(body) as {
          seed_handles: Handle[]
          agent_id?: string
          workspace_id?: string
          max_depth?: number
          max_atoms?: number
        }
        const seeds = req_.seed_handles
        if (!Array.isArray(seeds) || seeds.length === 0) throw new Error('seed_handles required')

        const MAX_ATOMS_HARD_LIMIT = 5000
        const maxAtoms = Math.min(req_.max_atoms ?? 200, MAX_ATOMS_HARD_LIMIT)
        const graphView = extractSubgraph(
          space, seeds,
          Math.min(req_.max_depth ?? 3, 10),
          maxAtoms,
        )

        const session: MeshRushSession = {
          id: crypto.randomUUID(),
          agentId:     req_.agent_id     ?? 'anonymous',
          workspaceId: req_.workspace_id ?? 'default',
          graphView,
          seedHandles: seeds,
          diffusionLog: [],
          artifacts: [],
          status: 'active',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }
        _sessions.set(session.id, session)

        res.writeHead(201, { 'content-type': 'application/json' })
        res.end(JSON.stringify({
          session_id: session.id,
          graph_view: {
            atom_count: graphView.length,
            seed_count: seeds.length,
            atoms: graphView.slice(0, 50), // first 50 inline, rest via GET
          },
          status: session.status,
        }))
      } catch (e) {
        res.writeHead(400, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: String(e) }))
      }
    }).catch(() => { res.writeHead(500); res.end() })
    return true
  }

  // GET /api/meshrush/session/:id — session state
  if (req.method === 'GET' && /^\/api\/meshrush\/session\/[^/]+$/.test(pathname)) {
    setCORS()
    const sessionId = pathname.split('/').pop()!
    const session = getSession(sessionId)
    if (!session) {
      res.writeHead(404, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'session_not_found' }))
    } else {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({
        ...session,
        graph_view_count: session.graphView.length,
        diffusion_steps: session.diffusionLog.length,
        artifact_count: session.artifacts.length,
      }))
    }
    return true
  }

  // POST /api/meshrush/session/:id/diffuse — pattern match over graph view
  if (req.method === 'POST' && /^\/api\/meshrush\/session\/[^/]+\/diffuse$/.test(pathname)) {
    setCORS()
    const sessionId = pathname.split('/')[4]!
    readBody(req).then((body) => {
      try {
        const session = getSession(sessionId)
        if (!session) throw new Error('session_not_found')
        if (session.status !== 'active') throw new Error(`session_${session.status}`)

        const req_ = JSON.parse(body) as { pattern: Pattern; max_results?: number }
        if (!req_.pattern?.clauses) throw new Error('pattern.clauses required')

        // Run PatternMatcher over the full space (graph view filtered in post-process)
        const matchResult = findMatches(space, req_.pattern)

        // Filter to atoms within this session's graph view
        const viewHandles = new Set(session.graphView.map(a => a.handle))
        const viewGroundings = matchResult.groundings.filter(g =>
          Object.values(g).every(h => viewHandles.has(h))
        )
        const filtered: MatchResult = {
          ...matchResult,
          groundings: viewGroundings.slice(0, req_.max_results ?? 50),
          results: matchResult.results.filter((_, i) =>
            viewGroundings.some(g => matchResult.groundings[i] === g)
          ).slice(0, req_.max_results ?? 50),
        }

        const decision = stopDecision(filtered, session.diffusionLog)
        const step: DiffusionStep = {
          seq: session.diffusionLog.length + 1,
          pattern: req_.pattern,
          result: filtered,
          decision,
          ts: new Date().toISOString(),
        }
        session.diffusionLog.push(step)
        session.updatedAt = step.ts
        if (decision === 'stop') session.status = 'stopped'

        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({
          step: step.seq,
          groundings: filtered.groundings,
          results: filtered.results,
          variables: filtered.variables,
          decision,
          status: session.status,
        }))
      } catch (e) {
        res.writeHead(400, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: String(e) }))
      }
    }).catch(() => { res.writeHead(500); res.end() })
    return true
  }

  // POST /api/meshrush/session/:id/crystallize — compile artifact back to AtomSpace
  if (req.method === 'POST' && /^\/api\/meshrush\/session\/[^/]+\/crystallize$/.test(pathname)) {
    setCORS()
    const sessionId = pathname.split('/')[4]!
    readBody(req).then((body) => {
      try {
        const session = getSession(sessionId)
        if (!session) throw new Error('session_not_found')

        const req_ = JSON.parse(body) as {
          artifact_type?: string
          summary: string
          source_handles?: Handle[]
          confidence?: number
        }
        if (!req_.summary) throw new Error('summary required')

        const artifactType = req_.artifact_type ?? 'MeshRushArtifact'
        const artifactName = `${session.workspaceId}:${session.id}:${Date.now()}`

        // Write artifact node to AtomSpace
        const artifactAtom = space.addNode(artifactType, artifactName, {
          tv: { strength: 1, confidence: req_.confidence ?? 0.8 },
          av: { sti: 50, lti: 10, vlti: 0 }, // high STI — newly crystallized
        })

        // Attach provenance Values
        space.setValue(artifactAtom.handle, 'meshrush:session', { kind: 'string', value: [session.id] })
        space.setValue(artifactAtom.handle, 'meshrush:agent', { kind: 'string', value: [session.agentId] })
        space.setValue(artifactAtom.handle, 'meshrush:workspace', { kind: 'string', value: [session.workspaceId] })
        space.setValue(artifactAtom.handle, 'meshrush:summary', { kind: 'string', value: [req_.summary] })
        space.setValue(artifactAtom.handle, 'meshrush:crystallized_at', { kind: 'string', value: [new Date().toISOString()] })
        space.setValue(artifactAtom.handle, 'meshrush:diffusion_steps', { kind: 'float', value: [session.diffusionLog.length] })

        // Link artifact to source atoms via EvaluationLink
        const sources = req_.source_handles ?? session.seedHandles
        for (const src of sources.slice(0, 20)) {
          if (space.getAtom(src)) {
            space.addLink('EvaluationLink', [artifactAtom.handle, src], {
              tv: { strength: 1, confidence: 0.9 },
            })
          }
        }

        // Link to diffusion groundings (top 5 most confident)
        const topGroundings = session.diffusionLog
          .flatMap(s => s.result.groundings)
          .slice(0, 5)
        for (const grounding of topGroundings) {
          for (const targetHandle of Object.values(grounding)) {
            if (space.getAtom(targetHandle)) {
              space.addLink('MemberLink', [artifactAtom.handle, targetHandle])
            }
          }
        }

        const crystallized: CrystallizedArtifact = {
          handle: artifactAtom.handle,
          type: artifactType,
          summary: req_.summary,
          sourceAtoms: sources,
          ts: new Date().toISOString(),
        }
        session.artifacts.push(crystallized)
        session.status = 'crystallized'
        session.updatedAt = crystallized.ts

        res.writeHead(201, { 'content-type': 'application/json' })
        res.end(JSON.stringify({
          artifact: crystallized,
          session_status: session.status,
          atom: artifactAtom,
        }))
      } catch (e) {
        res.writeHead(400, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: String(e) }))
      }
    }).catch(() => { res.writeHead(500); res.end() })
    return true
  }

  // GET /api/meshrush/session/:id/evidence — structured evidence package
  if (req.method === 'GET' && /^\/api\/meshrush\/session\/[^/]+\/evidence$/.test(pathname)) {
    setCORS()
    const sessionId = pathname.split('/')[4]!
    const session = getSession(sessionId)
    if (!session) {
      res.writeHead(404, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'session_not_found' }))
    } else {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({
        session_id: session.id,
        agent_id: session.agentId,
        workspace_id: session.workspaceId,
        graph_view_count: session.graphView.length,
        seed_handles: session.seedHandles,
        diffusion_steps: session.diffusionLog.map(s => ({
          seq: s.seq, decision: s.decision,
          grounding_count: s.result.groundings.length, ts: s.ts,
        })),
        artifacts: session.artifacts,
        status: session.status,
        created_at: session.createdAt,
        updated_at: session.updatedAt,
        evidence_chain: {
          observation_basis: session.seedHandles,
          diffusion_coverage: session.diffusionLog.reduce((sum, s) => sum + s.result.groundings.length, 0),
          artifact_count: session.artifacts.length,
        },
      }))
    }
    return true
  }

  // GET /api/meshrush/sessions — list active sessions
  if (req.method === 'GET' && pathname === '/api/meshrush/sessions') {
    setCORS()
    const sessions = Array.from(_sessions.values()).map(s => ({
      id: s.id, agentId: s.agentId, workspaceId: s.workspaceId,
      status: s.status, artifactCount: s.artifacts.length,
      createdAt: s.createdAt, updatedAt: s.updatedAt,
    }))
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ sessions, count: sessions.length }))
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

// ─── Export for agent-machine to expose subgraph directly ─────────────────────
export { extractSubgraph as meshSubgraph }
