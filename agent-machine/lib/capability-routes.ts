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
import { placeToFeatureEntry, mergeToConcordance, entityToCanonical, gaiaDocument, conformsToGaia, type GaiaRecord } from './gaia-bridge.js'
import { listLocalModels, generateOllamaText } from './ollama.js'
import { VectorIndex } from './vector-index.js'

const renderTemplate = (tpl: string, vars: Record<string, unknown>) => tpl.replace(/\{\{?(\w+)\}?\}/g, (_m, k: string) => (k in vars ? String(vars[k]) : `{${k}}`))

const MAX_CAP_BODY = 8 * 1024 * 1024   // 8MB cap — readBody owns enforcement (don't rely on the detached global guard)
function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let b = ''; let size = 0; let aborted = false
    req.on('data', (c: Buffer) => {
      if (aborted) return
      size += c.length
      if (size > MAX_CAP_BODY) { aborted = true; resolve(''); try { req.destroy() } catch { /* ignore */ } return }
      b += c.toString()
    })
    req.on('end', () => { if (!aborted) resolve(b) })
    req.on('error', () => resolve(''))
  })
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
      // ── RAG inspection / retrieval-debug (the genuine whitespace MS/Vertex do weakly) ──
      case 'rag-inspect': {
        const q = String(b.query ?? '')
        if (!q) return send(400, { error: 'query_required' }), true
        const { semanticSearch, lexicalSearch } = await import('./doc-store.js')
        let semantic: Array<{ text: string; source: string; score: number }> = []
        try { semantic = (await semanticSearch(q, 8)).map((h) => ({ text: String(h.text ?? '').slice(0, 400), source: String(h.filename ?? ''), score: Number(((h as { score?: number }).score ?? 0).toFixed(4)) })) } catch { /* no index */ }
        let lexical: Array<{ text: string; source: string; score: number }> = []
        try { lexical = lexicalSearch(q, 8).map((h) => ({ text: String(h.text ?? '').slice(0, 200), source: String(h.filename ?? ''), score: Number(((h as { score?: number }).score ?? 0).toFixed(4)) })) } catch { /* none */ }
        return send(200, { query: q, semantic, lexical, semanticCount: semantic.length, lexicalCount: lexical.length }), true
      }
      // ── AG-UI protocol conformance (Agent-User Interaction Protocol) ──
      case 'agui-run': {
        const { buildTextRun, isWellFormedRun } = await import('./ag-ui.js')
        const prompt = String(b.prompt ?? '')
        const model = String(b.model ?? (await listLocalModels())[0] ?? 'qwen2.5:7b')
        const out = await generateOllamaText({ model, messages: [{ role: 'user', content: prompt }], temperature: 0.7, numCtx: 8192 })
        const events = buildTextRun(String(b.threadId ?? 'thread'), String(b.runId ?? 'run'), 'msg-1', [out.content])
        return send(200, { protocol: 'ag-ui', events, wellFormed: isWellFormedRun(events) }), true
      }
      case 'agui-validate': {
        const { isWellFormedRun, isValidEvent } = await import('./ag-ui.js')
        const events = (b.events ?? []) as Array<{ type: string }>
        return send(200, { wellFormed: isWellFormedRun(events as never), invalid: events.filter((e) => !isValidEvent(e as never)).map((e) => e.type) }), true
      }
      // ── AI-ops workbench backends (prompt workbench, model compare, vector search) ──
      case 'models': return send(200, { models: await listLocalModels() }), true
      case 'prompt-run': {
        const prompt = renderTemplate(String(b.template ?? ''), (b.variables ?? {}) as Record<string, unknown>)
        const model = String(b.model ?? (await listLocalModels())[0] ?? 'qwen2.5:7b')
        const t0 = Date.now()
        const out = await generateOllamaText({ model, messages: [{ role: 'user', content: prompt }], temperature: Number(b.temperature ?? 0.7), numCtx: 8192 })
        return send(200, { output: out.content, model, prompt, latencyMs: Date.now() - t0 }), true
      }
      case 'model-compare': {
        const prompt = String(b.prompt ?? '')
        const models = ((b.models ?? []) as string[]).length ? (b.models as string[]) : (await listLocalModels()).slice(0, 3)
        const results = await Promise.all(models.map(async (model) => {
          const t0 = Date.now()
          try { const out = await generateOllamaText({ model, messages: [{ role: 'user', content: prompt }], temperature: 0.7, numCtx: 8192 }); return { model, output: out.content, latencyMs: Date.now() - t0, error: null } }
          catch { return { model, output: '', latencyMs: Date.now() - t0, error: 'generation_failed' } }
        }))
        return send(200, { prompt, results }), true
      }
      case 'vector-search': {
        const idx = new VectorIndex()
        idx.addMany((b.vectors ?? []) as Array<{ id: string; vec: number[] }>)
        return send(200, { results: idx.search((b.query ?? []) as number[], b.k ?? 10, b.excludeId) }), true
      }
      // ── Office toolkit (LibreOffice) + Porter PaaS ──
      case 'office-detect': {
        const { detectLibreOffice } = await import('./office-toolkit.js')
        return send(200, await detectLibreOffice()), true
      }
      case 'office-convert': {
        const { convertWithLibreOffice, canView, viewTargetFor } = await import('./office-toolkit.js')
        const os = await import('node:os'); const path = await import('node:path'); const fs = await import('node:fs')
        const root = path.join(os.homedir(), '.noetica')
        // SECURITY: resolve real path + require it INSIDE ~/.noetica (no traversal / arbitrary file read);
        // force the output dir (ignore attacker-supplied outdir).
        let real: string
        try { real = fs.realpathSync(path.resolve(String(b.path ?? ''))) } catch { return send(400, { error: 'file_not_found' }), true }
        if (real !== root && !real.startsWith(root + path.sep)) return send(403, { error: 'path_outside_allowed_root' }), true
        if (!canView(real)) return send(400, { error: 'not_a_viewable_office_file' }), true
        const to = (b.to === 'html' || b.to === 'pdf') ? b.to : viewTargetFor(real)
        return send(200, await convertWithLibreOffice(real, to, path.join(root, 'office-cache'))), true
      }
      case 'porter-config': {
        const { porterApp, porterCommands, toPorterYaml, conformsToPorter } = await import('./porter-paas.js')
        const app = porterApp({ name: String(b.name ?? 'noetica-app'), run: b.run as string | undefined, port: b.port as number | undefined, method: b.method as 'pack' | 'docker' | undefined, env: b.env as Record<string, string> | undefined })
        return send(200, { app, yaml: toPorterYaml(app), commands: porterCommands(app.name), conformance: conformsToPorter(app) }), true
      }
      // ── Artifact CMS (versioned, content-addressed) + drive integration ──
      case 'cms-create': {
        const { getArtifactCMS, persistArtifactCMS } = await import('./artifact-cms.js')
        const c = await getArtifactCMS()
        const m = c.create({ title: String(b.title ?? 'Untitled'), type: (b.type ?? 'document') as 'document', content: String(b.content ?? ''), tags: b.tags as string[] | undefined })
        await persistArtifactCMS()
        // Announce to the swarm by content hash (BitTorrent-for-artifacts: dedup + reuse + discovery).
        const { getSwarm, LOCAL_PROVIDER, persistSwarm, toMagnet } = await import('./artifact-swarm.js')
        const v0 = m.versions[m.versions.length - 1]!
        try { getSwarm().announce({ hash: v0.hash, title: m.title, type: m.type, size: v0.size, provider: LOCAL_PROVIDER, tags: m.tags }); await persistSwarm() } catch { /* swarm announce best-effort */ }
        return send(200, { artifact: m, magnet: toMagnet({ hash: v0.hash, title: m.title, type: m.type, size: v0.size }) }), true
      }
      // ── Artifact swarm: BitTorrent-style search / discovery / reuse / ranking ──
      case 'swarm-search': { const { getSwarm } = await import('./artifact-swarm.js'); return send(200, { results: getSwarm().search(String(b.query ?? ''), { topK: b.topK as number | undefined, type: b.type as string | undefined }) }), true }
      case 'swarm-top': { const { getSwarm } = await import('./artifact-swarm.js'); return send(200, { results: getSwarm().topByReuse(b.k as number | undefined) }), true }
      case 'swarm-rare': { const { getSwarm } = await import('./artifact-swarm.js'); return send(200, { results: getSwarm().rare(b.k as number | undefined) }), true }
      case 'swarm-announce': {
        const { getSwarm, isValidHash, persistSwarm } = await import('./artifact-swarm.js')
        if (!isValidHash(String(b.hash ?? ''))) return send(400, { error: 'invalid_hash' }), true
        const e = getSwarm().announce({ hash: String(b.hash), title: String(b.title ?? 'asset'), type: b.type as string | undefined, size: b.size as number | undefined, provider: String(b.provider ?? 'peer'), tags: Array.isArray(b.tags) ? b.tags as string[] : undefined })
        await persistSwarm()
        return send(200, { hash: e.hash, seeders: e.providers.size }), true
      }
      case 'swarm-reuse': { const { getSwarm, isValidHash, persistSwarm } = await import('./artifact-swarm.js'); if (!isValidHash(String(b.hash ?? ''))) return send(400, { error: 'invalid_hash' }), true; getSwarm().recordReuse(String(b.hash)); await persistSwarm(); return send(200, { ok: true, health: getSwarm().health(String(b.hash)) }), true }
      case 'magnet': { const { toMagnet, parseMagnet } = await import('./artifact-swarm.js'); return send(200, b.magnet ? { ref: parseMagnet(String(b.magnet)) } : { magnet: toMagnet({ hash: String(b.hash), title: b.title as string | undefined, type: b.type as string | undefined, size: b.size as number | undefined }) }), true }
      case 'cms-list': {
        const { getArtifactCMS } = await import('./artifact-cms.js')
        const c = await getArtifactCMS()
        return send(200, { artifacts: b.query ? c.search(String(b.query)) : c.list(b.filter as { type?: 'document'; tag?: string } | undefined) }), true
      }
      case 'cms-get': {
        const { getArtifactCMS } = await import('./artifact-cms.js')
        const c = await getArtifactCMS()
        const m = c.get(String(b.id))
        return send(m ? 200 : 404, m ? { artifact: m, content: c.getContent(String(b.id), b.version as number | undefined), history: c.history(String(b.id)) } : { error: 'not_found' }), true
      }
      case 'cms-update': {
        const { getArtifactCMS, persistArtifactCMS } = await import('./artifact-cms.js')
        const c = await getArtifactCMS()
        const m = c.update(String(b.id), String(b.content ?? ''), b.message as string | undefined)
        if (m) await persistArtifactCMS()
        return send(m ? 200 : 404, m ? { artifact: m } : { error: 'not_found' }), true
      }
      case 'cms-rollback': {
        const { getArtifactCMS, persistArtifactCMS } = await import('./artifact-cms.js')
        const c = await getArtifactCMS()
        const m = c.rollback(String(b.id), Number(b.version))
        if (m) await persistArtifactCMS()
        return send(m ? 200 : 404, m ? { artifact: m } : { error: 'not_found' }), true
      }
      case 'cms-to-drive': {
        const { writeArtifactToDrive } = await import('./artifact-cms.js')
        const r = await writeArtifactToDrive(String(b.id), String(b.workspace ?? 'default'))
        return send(r ? 200 : 404, r ?? { error: 'not_found' }), true
      }
      // ── OpenCog values: truth-weighted/attention-personalized ranking + PLN truth ──
      case 'weighted-rank': {
        const { weightedPageRank, stiNorm } = await import('./opencog-values.js')
        const prior = b.sti ? stiNorm(new Map(Object.entries(b.sti as Record<string, number>))) : undefined
        const ranks = weightedPageRank((b.nodes ?? []) as string[], (b.edges ?? []) as never, { prior })
        return send(200, { ranks: [...ranks.entries()].map(([id, score]) => ({ id, score })).sort((a, c) => c.score - a.score) }), true
      }
      case 'pln-truth': {
        const { deduction, revision, expectation, stv } = await import('./opencog-values.js')
        const a = stv(Number(b.a?.strength ?? 0), Number(b.a?.confidence ?? 0))
        const c = stv(Number(b.b?.strength ?? 0), Number(b.b?.confidence ?? 0))
        const op = b.op === 'revision' ? revision : deduction
        const r = op(a, c)
        return send(200, { op: b.op === 'revision' ? 'revision' : 'deduction', result: r, expectation: expectation(r) }), true
      }
      // ── repo bridges: new-hope membrane, sherlock evidence-answer, slash-topic scope ──
      case 'membrane-event': {
        const { membraneEvent, conformsToMembrane } = await import('./new-hope-membrane.js')
        const e = membraneEvent({ carrierRef: String(b.carrierRef ?? 'unknown'), message: String(b.message ?? ''), emittedAt: new Date().toISOString(), lineage: b.lineage as string[] | undefined, decision: (b.decision ?? {}) as { trust?: 'trusted' | 'internal' | 'untrusted'; injected?: boolean; allowed?: boolean } })
        return send(200, { event: e, conformance: conformsToMembrane(e) }), true
      }
      case 'evidence-answer': {
        const { buildEvidenceAnswer, conformsToEvidenceAnswer } = await import('./sherlock-evidence.js')
        const a = buildEvidenceAnswer({ query: String(b.query ?? ''), anchors: (b.anchors ?? []) as never, evidence: (b.evidence ?? []) as never, proposedClaims: (b.proposedClaims ?? []) as never })
        return send(200, { answer: a, conformance: conformsToEvidenceAnswer(a) }), true
      }
      case 'topic-scope': {
        const { applyScope, packDigest, conformsToTopicPack } = await import('./slash-topic-scope.js')
        const pack = (b.pack ?? { topic: '/all', version: '1', include: [] }) as { topic: string; version: string; include: string[]; exclude?: string[] }
        const scoped = applyScope((b.items ?? []) as Array<{ text: string }>, pack)
        return send(200, { ...scoped, digest: packDigest(pack), conformance: conformsToTopicPack(pack) }), true
      }
      // ── lattice-forge: express Noetica's runtimes as governed RuntimeAsset manifests ──
      case 'runtime-assets': {
        const { modelRuntimeAsset, sidecarRuntimeAsset, conformsToLattice } = await import('./lattice-forge.js')
        const now = new Date().toISOString()
        const models = await listLocalModels()
        const assets = [
          ...models.map((m) => modelRuntimeAsset(m, { createdAt: now })),
          sidecarRuntimeAsset('noetica-embed', { version: '0.1.0', createdAt: now, languages: ['rust'], runtimeClass: 'embed-sidecar' }),
          sidecarRuntimeAsset('noetica-voice', { version: '0.1.0', createdAt: now, languages: ['python'], runtimeClass: 'tts-sidecar' }),
        ]
        return send(200, { apiVersion: 'lattice.socioprophet.dev/v1', count: assets.length, assets: assets.map((a) => ({ ...a, _conformance: conformsToLattice(a) })) }), true
      }
      // ── canonical GAIA ontology export (conformant JSON-LD) ──
      case 'gaia-export': {
        const recs: GaiaRecord[] = [
          ...((b.places ?? []) as Array<{ name: string; lat?: number; lon?: number; type?: string }>).map((p) => placeToFeatureEntry(p, { verified: !!b.verified })),
          ...((b.merges ?? []) as Array<{ a: string; b: string; confidence?: number }>).map((m) => mergeToConcordance(m)),
          ...((b.entities ?? []) as Array<{ id: string; label: string }>).map((e) => entityToCanonical(e.id, e.label)),
        ]
        return send(200, { document: gaiaDocument(recs), conformance: recs.map((r) => ({ id: r['@id'], ...conformsToGaia(r) })) }), true
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
