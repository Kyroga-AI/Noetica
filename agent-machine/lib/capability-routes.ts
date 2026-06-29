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

const renderTemplate = (tpl: string, vars: Record<string, unknown>) => tpl.replace(/\{\{?(\w+)\}?\}/g, (_m, k: string) => (Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : `{${k}}`))
// Object.entries from attacker JSON, minus prototype-pollution keys (used where bodies → Maps/lookups).
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype'])
const safeEntries = <T,>(o: unknown): Array<[string, T]> => (o && typeof o === 'object' ? (Object.entries(o as Record<string, T>).filter(([k]) => !DANGEROUS_KEYS.has(k))) : [])

const MAX_CAP_BODY = 8 * 1024 * 1024   // 8MB cap — readBody owns enforcement (don't rely on the detached global guard)
const MUTATING_ROUTES = new Set(['cms-create', 'cms-update', 'cms-rollback', 'cms-to-drive', 'proposals-apply', 'infer-apply', 'auto-kg', 'synapse-enrich', 'pdor-ingest', 'connector-run', 'swarm-announce', 'swarm-reuse', 'office-convert'])
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

  // Kill-switch coverage: when armed, the kill-switch must halt the WHOLE agent — not just /api/chat. The cap
  // routes run local models, mutate the graph/CMS/swarm, and provision cloud — so a state-changing cap call is
  // blocked while killed. (Read-only GETs are allowed so the UI can still show state.)
  if (req.method === 'POST') {
    try { const { containmentState } = await import('./agent-containment.js'); if (containmentState().killed) { send(503, { error: 'kill_switch_armed' }); return true } } catch { /* containment unavailable → allow */ }
  }

  // CSRF/DNS-rebinding guard on STATE-CHANGING routes: loopback binding stops remote net attackers, but a
  // malicious web page could fetch() localhost. Reject a real cross-site http(s) Origin, and require a JSON
  // content-type (a simple text/plain POST skips CORS preflight). Same-origin / tauri / no-Origin (the app) pass.
  if (req.method === 'POST' && MUTATING_ROUTES.has(path)) {
    const origin = req.headers['origin']
    if (typeof origin === 'string' && /^https?:\/\//i.test(origin) && !/^https?:\/\/(127\.0\.0\.1|localhost)(:|$|\/)/i.test(origin)) { send(403, { error: 'cross_origin_blocked' }); return true }
    if (!String(req.headers['content-type'] ?? '').includes('application/json')) { send(415, { error: 'json_content_type_required' }); return true }
  }
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
        const d = new Map<string, Derivation>(safeEntries<Derivation>(b.derivations))
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
      // ── Self-hardening: adversarial security review on LOCAL models, scope-d-audited ──
      case 'security-review': {
        const { reviewCode } = await import('./security-review.js')
        return send(200, await reviewCode(String(b.code ?? ''), { subject: b.subject as string | undefined, model: b.model as string | undefined })), true
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
        const { porterApp, porterCommands, toPorterYaml, conformsToPorter, planPorterDeploy } = await import('./porter-paas.js')
        const app = porterApp({ name: String(b.name ?? 'noetica-app'), run: b.run as string | undefined, port: b.port as number | undefined, method: b.method as 'pack' | 'docker' | undefined, env: b.env as Record<string, string> | undefined, compute: b.compute as never, model: b.model as string | undefined })
        // If a compute/model target is set, resolve the deploy plan (broker cheapest cloud + model provider).
        const plan = (app.compute || app.model) ? await planPorterDeploy(app) : null
        return send(200, { app, yaml: toPorterYaml(app), commands: porterCommands(app.name), conformance: conformsToPorter(app), plan }), true
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
        const prior = b.sti ? stiNorm(new Map(safeEntries<number>(b.sti))) : undefined
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
      // ── swarm volume: a local TopoLVM-style mount the agents share to form a swarm ──
      case 'swarm-volume': {
        const sv = await import('./swarm-volume.js')
        const swarmId = String(b.swarmId ?? 'default')
        switch (String(b.action ?? 'provision')) {
          case 'join':    return send(200, sv.joinSwarm(swarmId, String(b.agentId ?? 'agent'), b.role as string | undefined)), true
          case 'leave':   return send(200, { manifest: sv.leaveSwarm(swarmId, String(b.agentId ?? 'agent')) }), true
          case 'members': return send(200, { members: sv.swarmMembers(swarmId), lvmAvailable: sv.lvmAvailable() }), true
          default:        return send(200, { volume: sv.provisionSwarmVolume({ swarmId, sizeGiB: b.sizeGiB as number | undefined, backend: b.backend as 'auto' | 'lvm' | 'directory' | undefined }), lvmAvailable: sv.lvmAvailable() }), true
        }
      }
      // ── alignment: how does ingested text (news/doc) align with your brain (docs + chat docs)? ──
      case 'align-check': {
        const { splitClaims, alignClaims } = await import('./alignment.js')
        const text = String(b.text ?? '')
        if (!text.trim()) return send(400, { error: 'text required' }), true
        const claims = splitClaims(text)
        let brain: Array<{ id: string; text: string; source?: string }> = []
        try {
          const { searchDocsReranked } = await import('./doc-store.js')
          const query = claims.join(' ').slice(0, 800) || text.slice(0, 800)
          const hits = await searchDocsReranked(query, 40)
          brain = hits.map((h) => ({ id: h.docId, text: h.text, source: h.citation }))
        } catch { /* no docs yet → everything reads as novel */ }
        // SEMANTIC matching: embed claims + brain once via the local sidecar, compare by cosine (catches
        // paraphrases the lexical jaccard misses). Falls back to jaccard if the embedder is unavailable.
        let sim: ((a: string, b: string) => number) | undefined
        try {
          const { embedBatchLocal } = await import('./embed-runtime.js')
          const cos = (a: number[], b: number[]) => { let d = 0, na = 0, nb = 0; for (let i = 0; i < a.length; i++) { d += a[i]! * b[i]!; na += a[i]! * a[i]!; nb += b[i]! * b[i]! } return na && nb ? d / (Math.sqrt(na) * Math.sqrt(nb)) : 0 }
          const texts = [...claims, ...brain.map((x) => x.text)]
          const vecs = await embedBatchLocal(texts)
          if (vecs && vecs.every(Boolean)) {
            const vm = new Map<string, number[]>(); texts.forEach((t, i) => vm.set(t, vecs[i] as number[]))
            sim = (a, b) => { const va = vm.get(a), vb = vm.get(b); return va && vb ? cos(va, vb) : 0 }
          }
        } catch { /* embedder offline → lexical jaccard fallback */ }
        return send(200, { ...alignClaims(claims, brain, { sim }), brainStatements: brain.length, matching: sim ? 'semantic' : 'lexical' }), true
      }
      // ── multi-cloud compute broker: route a workload to the cheapest satisfying provider ──
      case 'cloud-broker': {
        const { brokerCompute, brokerSavings, toAgentplanePlacement, toFogPlacements, COMPUTE_CATALOG } = await import('./cloud-broker.js')
        // Opt-in live pricing: refresh real Azure prices (public API) over the static catalogue before ranking.
        let catalog = COMPUTE_CATALOG
        let priceSource = 'static-catalogue'
        if (b.live === true) {
          try {
            const { refreshLivePrices, mergeLivePrices } = await import('./cloud-pricing.js')
            const live = await refreshLivePrices(Date.now(), typeof b.region === 'string' ? b.region : 'eastus')
            if (live.length) { catalog = mergeLivePrices(COMPUTE_CATALOG, live); priceSource = `live:azure(${live.length} skus)` }
          } catch { /* fall back to static */ }
        }
        const result = brokerCompute((b.request ?? {}) as Parameters<typeof brokerCompute>[0], catalog)
        // Optionally PROVISION the cheapest pick: plan the lifecycle (cloud-init + create/teardown commands),
        // register it as an agentplane executor + swarm node. Real cloud exec is gated server-side.
        let provision = null
        if (b.provision === true && result.best && result.best.sku.provider !== 'local') {
          const { provisionInstance, executeProvision } = await import('./cloud-provision.js')
          provision = provisionInstance(result.best.sku, { swarmId: typeof b.swarmId === 'string' ? b.swarmId : 'session', usdPerHour: result.best.effectivePerHour })
          if (b.exec === true) provision = await executeProvision(provision)   // double-gated by NOETICA_CLOUD_PROVISION_EXEC
        }
        // Emit an agentplane-conformant PlacementDecision so the cheapest-cloud pick feeds agentplane's fleet.
        return send(200, { ...result, priceSource, savings: brokerSavings(result), placement: toAgentplanePlacement(result, { lane: b.lane === 'prod' ? 'prod' : 'staging' }), fogPlacements: toFogPlacements(result), provision }), true
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
      case 'pdor-onboard': {
        // PDOR (Prophet Data On-boarding Request) → governed Commons onboarding. Evaluate the request (tier +
        // the open-vs-segmented brain-eligibility gate); if an ingest key is issued, characterize the supplied
        // table (types, quality, sensitive scan, geo/temporal). Returns the decision + characterization; the
        // caller persists the catalog node + lineage. Graph linkage (auto-KG) + SynapseIQ enrichment compose on top.
        const { evaluatePdor } = await import('./data-onboarding.js')
        const { characterize, parseDelimited } = await import('./characterization.js')
        const decision = evaluatePdor(b.pdor as Parameters<typeof evaluatePdor>[0], (b.verdicts ?? []) as Parameters<typeof evaluatePdor>[1])
        let characterization = null
        if (decision.ingestKey) {
          const table = typeof b.csv === 'string' ? parseDelimited(b.csv, typeof b.delim === 'string' ? b.delim : ',') : (b.table ?? null)
          if (table && Array.isArray(table.header)) characterization = characterize(table)
        }
        return send(200, { decision, characterization }), true
      }
      case 'auto-kg': {
        // Auto-extract a KG from a user doc → PENDING proposals (governance: segmented from the authored canon,
        // never auto-canonical). persist:true applies them through the same review/writeback path as proposals-apply.
        const { extractKnowledgeGraph } = await import('./auto-kg.js')
        const model = String(b.model ?? (await listLocalModels())[0] ?? 'qwen2.5:7b')
        const gen = async (prompt: string) => (await generateOllamaText({ model, messages: [{ role: 'user', content: prompt }], temperature: 0, numCtx: 8192 })).content
        const r = await extractKnowledgeGraph(String(b.text ?? ''), String(b.source ?? 'user-doc'), gen, { maxTriples: Number(b.maxTriples ?? 20) })
        const persisted = b.persist === true ? persistProposals(r.proposals) : null
        return send(200, { ...r, persisted }), true
      }
      case 'synapse-enrich': {
        // SynapseIQ structural enrichment → KG linkage: parse the asset into typed symbols/entities (Tree-sitter
        // + LSP, deterministic fallback when SynapseIQ is unavailable), bridge to auto-KG triples → PENDING
        // proposals (governed). persist:true applies them via the same review/writeback path as proposals-apply.
        const { synapseEnrich, enrichmentToTriples, defaultSynapseTransport } = await import('./synapseiq-enrich.js')
        const { triplesToProposals } = await import('./auto-kg.js')
        const assetId = String(b.assetId ?? b.source ?? 'asset')
        const enrichment = await synapseEnrich(String(b.content ?? ''), { filename: b.filename as string | undefined }, defaultSynapseTransport())
        const proposals = triplesToProposals(enrichmentToTriples(assetId, enrichment), assetId)
        const persisted = b.persist === true ? persistProposals(proposals) : null
        return send(200, { enrichment, proposals, persisted }), true
      }
      case 'pdor-ingest': {
        // The onboarding CAPSTONE: run the full Commons pipeline end-to-end as one governed transaction.
        // evaluate the PDOR (tier + open-vs-segmented gate) → if an ingest key is issued, characterize the
        // supplied table + SynapseIQ-enrich the content → build the catalog node + provenance/linkage edges →
        // persist into the graph (governed). Nothing enters the graph without a key.
        const { evaluatePdor } = await import('./data-onboarding.js')
        const { characterize, parseDelimited } = await import('./characterization.js')
        const { synapseEnrich, defaultSynapseTransport } = await import('./synapseiq-enrich.js')
        const { buildCatalogGraph } = await import('./pdor-ingest.js')
        const pdorReq = b.pdor as Parameters<typeof evaluatePdor>[0]
        const decision = evaluatePdor(pdorReq, (b.verdicts ?? []) as Parameters<typeof evaluatePdor>[1])
        let characterization = undefined, enrichment = undefined
        if (decision.ingestKey) {
          const table = typeof b.csv === 'string' ? parseDelimited(b.csv, typeof b.delim === 'string' ? b.delim : ',') : (b.table ?? null)
          if (table && Array.isArray(table.header)) characterization = characterize(table)
          if (typeof b.content === 'string' && b.content) enrichment = await synapseEnrich(b.content, { filename: b.filename as string | undefined }, defaultSynapseTransport())
        }
        const catalog = buildCatalogGraph(pdorReq, decision, { characterization, enrichment, fileUri: b.fileUri as string | undefined })
        const persisted = b.persist === true && catalog.proposals.length ? persistProposals(catalog.proposals) : null
        return send(200, { decision, characterization: characterization ?? null, enrichment: enrichment ?? null, catalog, persisted }), true
      }
      case 'connector-run': {
        // Governed connector ingest: authorize egress → fetch → emit a tamper-evident ConnectorReceipt. The
        // route exposes the MANUAL (local, no-egress) connector — docs supplied in the body — the offline-safe
        // reference; network connectors register server-side with a scope-d-backed authorize hook.
        const { runConnector, manualConnector } = await import('./connector.js')
        const run = await runConnector(manualConnector(String(b.id ?? 'manual'), (b.docs ?? []) as Array<{ uri?: string; title?: string; text: string }>))
        return send(200, run), true
      }
      // ── graph-derived (GET) ──
      case 'graph-triples': {
        const g = getGraph()
        const triples = g.allEdges().slice(0, 5000).map((e) => ({ s: e.from, p: e.label, o: e.to }))
        return send(200, { count: triples.length, triples: triples.slice(0, 500) }), true
      }
      default: return send(404, { error: 'unknown_capability', path }), true
    }
  } catch (e) {
    // Log server-side so cap-route failures aren't invisible (CodeQL: strip CR/LF, no raw error in the path).
    try { const msg = e instanceof Error ? e.message : 'error'; console.error('[cap]', url.pathname.replace(/[\r\n]/g, ' '), '-', msg.replace(/[\r\n]/g, ' ').slice(0, 200)) } catch { /* ignore */ }
    send(500, { error: 'internal_error' })
    return true
  }
}
