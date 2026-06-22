/**
 * capability-routes.ts — live API surface for the wave-2/wave-3 capability libs. Each handler is a thin
 * wrapper: parse JSON body → call the tested lib → return. Mounted once in server.ts via handleCapabilityRoute
 * under /api/cap/*. This is the integration layer that turns the pure libs into reachable product features.
 */
import type * as http from 'http'
import { getGraph } from './graph.js'
import { findColocations, type Ping } from './colocation.js'
import { emergingHotspots, type GeoEvent } from './geo-anomaly.js'
import { detectStops } from './movement.js'
import { buildBaseline, deviations, type Activity } from './pattern-of-life.js'
import { reachableWithin, isFeasibleTrip, type TimedEdge } from './isochrone.js'
import { entityRiskScore, type EntitySignals } from './entity-risk.js'
import { mineRules, type Triple } from './rule-mining.js'
import { evaluate as datalogEval, type Fact, type Rule } from './datalog-lite.js'
import { deriveDefeasible, type DefRule, type Superiority } from './defeasible.js'
import { buildProof, baseFacts, rulesUsed, explainProof, type Derivation } from './provenance.js'
import { classifyEntailment } from './entailment.js'
import { validateAll, type Shape } from './graph-shapes.js'
import { selectBestOfN, type VerifiedCandidate } from './best-of-n.js'
import { decideAnswer, semanticClusters, semanticEntropy, normalizedEntropy } from './uncertainty.js'
import { majorityVote } from './self-consistency.js'
import { contextPrecision, contextRecall, contextualPrecisionAtK } from './rag-eval.js'
import { brier, ece, riskCoverage } from './calibration.js'
import { reciprocalRankFusion } from './rerank-rrf.js'
import { bm25, fuseHybrid, type Doc } from './hybrid-retrieve.js'
import { injectionScore } from './injection-classifier.js'
import { detectRemoteRenderExfil } from './egress-hygiene.js'
import { gateEgress, type TaintedValue } from './capability-egress.js'
import { monitorTrajectory, type AgentAction } from './trajectory-monitor.js'
import { parseMemoryExport } from './memory-import.js'
import { buildMindMap, flattenOutline, countNodes } from './mind-map.js'
import { makeCredential, markAIGenerated, manifestDigest } from './content-credentials.js'
import { persistProposals, persistInferred } from './graph-writeback.js'
import type { GraphProposal } from './graph-proposals.js'

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => { let b = ''; req.on('data', (c: Buffer) => { b += c.toString() }); req.on('end', () => resolve(b)); req.on('error', () => resolve('')) })
}

const edgesToMap = (edges: Array<{ from: string; to: string; minutes: number }>): Map<string, TimedEdge[]> => {
  const m = new Map<string, TimedEdge[]>()
  for (const e of edges) (m.get(e.from) ?? m.set(e.from, []).get(e.from)!).push({ to: e.to, minutes: e.minutes })
  return m
}

/** Returns true if it handled the route. */
export async function handleCapabilityRoute(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<boolean> {
  if (!url.pathname.startsWith('/api/cap/')) return false
  const path = url.pathname.slice('/api/cap/'.length)
  const send = (code: number, obj: unknown) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)) }
  try {
    const raw = req.method === 'POST' ? await readBody(req) : '{}'
    const b = JSON.parse(raw || '{}') as Record<string, any>
    switch (path) {
      // ── geo / investigation ──
      case 'colocation': return send(200, { colocations: findColocations((b.pings ?? []) as Ping[], b.opts ?? {}) }), true
      case 'hotspots': return send(200, { hotspots: emergingHotspots((b.events ?? []) as GeoEvent[], { now: b.now ?? 0, ...(b.opts ?? {}) }) }), true
      case 'stops': return send(200, { stops: detectStops((b.pings ?? []) as Ping[], b.opts ?? {}) }), true
      case 'pattern-of-life': {
        const base = buildBaseline((b.history ?? []) as Activity[])
        return send(200, { deviations: deviations(b.activity as Activity, base, b.opts ?? {}) }), true
      }
      case 'isochrone': {
        const g = edgesToMap((b.edges ?? []) as Array<{ from: string; to: string; minutes: number }>)
        return send(200, { reachable: reachableWithin(g, b.source as string, b.budgetMin ?? 30), feasible: b.to ? isFeasibleTrip(g, b.source, b.to, b.budgetMin ?? 30) : undefined }), true
      }
      case 'entity-risk': return send(200, entityRiskScore(b.signals as EntitySignals)), true
      // ── reasoning / KR ──
      case 'rule-mining': return send(200, { rules: mineRules((b.triples ?? []) as Triple[], b.opts ?? {}) }), true
      case 'datalog': return send(200, { facts: datalogEval((b.facts ?? []) as Fact[], (b.rules ?? []) as Rule[]) }), true
      case 'defeasible': return send(200, deriveDefeasible((b.facts ?? []) as string[], (b.rules ?? []) as DefRule[], (b.superiority ?? []) as Superiority[])), true
      case 'provenance': {
        const d = new Map<string, Derivation>(Object.entries((b.derivations ?? {}) as Record<string, Derivation>))
        const proof = buildProof(b.fact as string, d)
        return send(200, { proof, baseFacts: baseFacts(proof), rules: rulesUsed(proof), explanation: explainProof(proof) }), true
      }
      case 'entailment': return send(200, classifyEntailment(b.premise as string, b.hypothesis as string, undefined, b.opts ?? {})), true
      case 'validate': return send(200, { violations: validateAll((b.nodes ?? []) as Array<{ id: string; kind: string; props: Record<string, unknown> }>, (b.shapes ?? []) as Shape[]) }), true
      case 'mind-map': {
        const tree = buildMindMap(b.root as string, (b.edges ?? []) as Array<{ parent: string; child: string }>)
        return send(200, { tree, outline: flattenOutline(tree), nodes: countNodes(tree) }), true
      }
      // ── quality / selection ──
      case 'best-of-n': return send(200, selectBestOfN((b.candidates ?? []) as VerifiedCandidate[])), true
      case 'uncertainty': {
        const clusters = b.samples ? semanticClusters(b.samples as string[], (x: string, y: string) => x.trim().toLowerCase() === y.trim().toLowerCase()) : []
        const entropy = b.samples ? normalizedEntropy(clusters) : (b.entropy ?? 0)
        return send(200, { decision: decideAnswer({ verified: !!b.verified, coverage: b.coverage ?? 0, entropy, agreement: b.agreement }), entropy, entropyBits: clusters.length ? semanticEntropy(clusters) : undefined }), true
      }
      case 'self-consistency': return send(200, majorityVote((b.answers ?? []) as string[])), true
      case 'rag-eval': return send(200, { precision: contextPrecision((b.retrieved ?? []) as Array<{ relevant: boolean }>), recall: b.referenceIds ? contextRecall((b.retrievedIds ?? []) as string[], b.referenceIds as string[]) : undefined, orderAware: b.rankedRelevance ? contextualPrecisionAtK(b.rankedRelevance as boolean[]) : undefined }), true
      case 'calibration': return send(200, { brier: brier(b.preds ?? []), ece: ece(b.preds ?? []), riskCoverage: riskCoverage(b.preds ?? []) }), true
      // ── retrieval ──
      case 'rrf': return send(200, { fused: reciprocalRankFusion((b.rankings ?? []) as string[][], b.k ?? 60) }), true
      case 'hybrid-retrieve': return send(200, { lexical: bm25(b.query as string, (b.docs ?? []) as Doc[]), fused: b.denseRankedIds ? fuseHybrid(b.query, (b.docs ?? []) as Doc[], b.denseRankedIds as string[]) : undefined }), true
      // ── safety ──
      case 'injection-check': return send(200, injectionScore(b.text as string)), true
      case 'egress-check': return send(200, { renderExfil: detectRemoteRenderExfil(b.text ?? '', (b.allowlist ?? []) as string[]), gate: b.args ? gateEgress(b.args as TaintedValue[], { requires: b.requires ?? 'internal' }) : undefined }), true
      case 'trajectory': return send(200, monitorTrajectory((b.actions ?? []) as AgentAction[], b.opts ?? {})), true
      // ── memory / output ──
      case 'memory-import': return send(200, { memories: parseMemoryExport(b.text as string, b.source ?? 'import') }), true
      case 'content-credential': {
        const cred = makeCredential({ model: b.model as string, timestamp: b.timestamp as string, sourceRefs: b.sourceRefs ?? [] })
        return send(200, { credential: cred, digest: manifestDigest(cred), marked: b.text ? markAIGenerated(b.text as string, cred) : undefined }), true
      }
      // ── HellGraph write-back (PERSIST derived knowledge into the store) ──
      case 'proposals-apply': return send(200, persistProposals((b.proposals ?? []) as GraphProposal[])), true
      case 'infer-apply': return send(200, persistInferred((b.inferred ?? []) as Array<{ subject: string; predicate: string; object: string; via?: string; verified?: boolean }>)), true
      // ── graph-derived (GET) ──
      case 'graph-triples': {
        const g = getGraph()
        const triples = g.allEdges().slice(0, 5000).map((e) => ({ s: e.from, p: e.label, o: e.to }))
        return send(200, { count: triples.length, triples: triples.slice(0, 500) }), true
      }
      default: return send(404, { error: 'unknown_capability', path }), true
    }
  } catch (e) {
    send(500, { error: 'internal_error' })
    return true
  }
}
