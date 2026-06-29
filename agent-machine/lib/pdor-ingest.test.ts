import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildCatalogGraph } from './pdor-ingest.js'
import { evaluatePdor, type Pdor } from './data-onboarding.js'
import { characterize, parseDelimited } from './characterization.js'
import { synapseEnrich } from './synapseiq-enrich.js'
import { persistProposals } from './graph-writeback.js'

const pdor = (over: Partial<Pdor> = {}): Pdor => ({
  id: 'oct-18.01', requester: 'r', intent: 'capture',
  source: { name: 'MIT OCW 18.01' }, license: { type: 'cc-by' }, ...over,
})

const edge = (props: GraphProposalLike[], rel: string) => props.find((p) => p.op === 'add-edge' && (p.payload as any).rel === rel)
type GraphProposalLike = { op: string; payload: Record<string, unknown> }

test('open self-certified PDOR → catalog asset node, brain-eligible, with PDOR + license edges', () => {
  const d = evaluatePdor(pdor())
  const g = buildCatalogGraph(pdor(), d)
  assert.equal(g.ingested, true)
  const asset = g.proposals.find((p) => p.op === 'add-node' && (p.payload as any).kind === 'CommonsAsset')!
  assert.equal((asset.payload as any).brainEligible, true)
  assert.equal((asset.payload as any).segmented, false)
  assert.ok(edge(g.proposals, 'requested_via'))
  assert.ok(edge(g.proposals, 'licensed_under'))
})

test('segmented (CC-BY-SA, approved) → asset segmented + governed_by segment-from-brain', () => {
  const p = pdor({ license: { type: 'cc-by-sa' } })
  const d = evaluatePdor(p, [{ reviewer: 'a', role: 'license', approve: true }, { reviewer: 'b', role: 'segmentation', approve: true }])
  const g = buildCatalogGraph(p, d)
  const asset = g.proposals.find((x) => (x.payload as any).kind === 'CommonsAsset')!
  assert.equal((asset.payload as any).segmented, true)
  assert.equal((asset.payload as any).brainEligible, false)
  const govEdges = g.proposals.filter((x) => x.op === 'add-edge' && (x.payload as any).rel === 'governed_by').map((x) => (x.payload as any).to)
  assert.ok(govEdges.includes('rule:segment-from-brain'))
})

test('NO ingest key (needs-review / declined / bookmark) → nothing enters the graph', () => {
  const needs = buildCatalogGraph(pdor({ license: { type: 'cc-by-nc' } }), evaluatePdor(pdor({ license: { type: 'cc-by-nc' } })))
  assert.equal(needs.ingested, false)
  assert.equal(needs.proposals.length, 0)
  const declined = buildCatalogGraph(pdor(), evaluatePdor(pdor({ license: { type: 'proprietary' } }), [{ reviewer: 'a', role: 'license', approve: false }]))
  assert.equal(declined.ingested, false)
  const bookmark = buildCatalogGraph(pdor({ intent: 'register' }), evaluatePdor(pdor({ intent: 'register' })))
  assert.equal(bookmark.ingested, false)
})

test('characterization → classification Terms + profile props on the asset', () => {
  const p = pdor()
  const c = characterize(parseDelimited('city,lat,lon,when\nAustin,30.2,-97.7,2001-01-01\nDallas,32.7,-96.8,2014-06-01'))
  const g = buildCatalogGraph(p, evaluatePdor(p), { characterization: c })
  const terms = g.proposals.filter((x) => x.op === 'add-edge' && (x.payload as any).rel === 'classified_as').map((x) => (x.payload as any).to)
  assert.ok(terms.includes('term:geospatial'))
  assert.ok(terms.includes('term:temporal'))
  // profile is folded into the asset node (not a separate update-prop, which the persistor can't write)
  const asset = g.proposals.find((x) => (x.payload as any).kind === 'CommonsAsset')!
  assert.equal((asset.payload as any).hasGeo, true)
  assert.equal((asset.payload as any).rows, 2)
})

test('SynapseIQ enrichment → asset contains symbol edges (entity linkage)', async () => {
  const p = pdor()
  const e = await synapseEnrich('def integrate(f):\n pass\nclass Series: pass', { filename: 'calc.py' })
  const g = buildCatalogGraph(p, evaluatePdor(p), { enrichment: e })
  const contains = g.proposals.filter((x) => x.op === 'add-edge' && (x.payload as any).rel === 'contains').map((x) => (x.payload as any).to)
  assert.ok(contains.includes('integrate') && contains.includes('Series'))
})

test('fileUri → stored_as edge to the physical file', () => {
  const p = pdor()
  const g = buildCatalogGraph(p, evaluatePdor(p), { fileUri: 'gs://commons/18.01/notes.pdf' })
  assert.ok(g.proposals.some((x) => x.op === 'add-edge' && (x.payload as any).rel === 'stored_as' && (x.payload as any).to === 'file:gs://commons/18.01/notes.pdf'))
})

test('all catalog proposals are tagged source pdor-ingest — INCLUDING enrichment edges', async () => {
  const p = pdor()
  const e = await synapseEnrich('def f():\n pass\nclass G: pass', { filename: 'a.py' })
  const g = buildCatalogGraph(p, evaluatePdor(p), { enrichment: e })
  // enrichment edges come through triplesToProposals (which self-tags auto-kg) — must be re-tagged pdor-ingest
  assert.ok(g.proposals.some((x) => x.op === 'add-edge' && (x.payload as any).rel === 'contains'))
  assert.ok(g.proposals.every((x) => x.source === 'pdor-ingest'))
})

test('catalog proposals are ACCEPTED (the ingest key is the gate) so they actually persist', () => {
  const g = buildCatalogGraph(pdor(), evaluatePdor(pdor()))
  assert.ok(g.proposals.every((p) => p.status === 'accepted'))
})

test('persist: the asset node (with moat-safe flags + label) and edges actually land in the graph', () => {
  // minimal in-memory WritableGraph satisfying persistProposals' needs
  const nodes = new Map<string, { id: string; props: Record<string, unknown> }>()
  const edges: Array<{ label: string; from: string; to: string }> = []
  const store = {
    getNode: (id: string) => nodes.get(id),
    addNode: (id: string, _k: string[], props: Record<string, unknown>) => { nodes.set(id, { id, props }) },
    addEdge: (label: string, from: string, to: string) => { edges.push({ label, from, to }) },
    allEdges: () => edges,
  }
  const p = pdor({ license: { type: 'cc-by' } })
  const c = characterize(parseDelimited('a,b\n1,x\n2,y'))
  const g = buildCatalogGraph(p, evaluatePdor(p), { characterization: c })
  const res = persistProposals(g.proposals, { store: store as never })
  assert.ok(res.written > 0)                                  // NOT a no-op
  assert.equal(res.skipped, 0)
  const asset = nodes.get('asset:oct-18.01')!
  assert.ok(asset, 'asset node written')
  assert.equal(asset.props['brainEligible'], true)            // moat-safe flag reached the node
  assert.equal(asset.props['segmented'], false)
  assert.equal(asset.props['label'], 'MIT OCW 18.01')         // label (not the raw assetId)
  assert.equal(asset.props['rows'], 2)                        // characterization profile reached the node
  assert.ok(edges.some((e) => e.label === 'requested_via'))
  assert.ok(edges.some((e) => e.label === 'licensed_under'))
})
