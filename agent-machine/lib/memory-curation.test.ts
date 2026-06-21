import { test } from 'node:test'
import assert from 'node:assert/strict'
import { listMemories, pinMemory, unpinMemory, forgetMemory, findSimilarMemory, selectRelevantMemories, PINNED_LTI, type MemoryStore, type MemoryNode } from './memory-curation.js'

class FakeStore implements MemoryStore {
  nodes = new Map<string, MemoryNode>()
  edges: Array<{ from: string; to: string }> = []
  ltiCalls: Array<{ id: string; lti: number }> = []
  add(id: string, labels: string[], properties: Record<string, unknown>) { this.nodes.set(id, { id, labels, properties }); return this.nodes.get(id)! }
  link(from: string, to: string) { this.edges.push({ from, to }) }
  nodesByLabel(label: string) { return [...this.nodes.values()].filter((n) => n.labels.includes(label)) }
  getNode(id: string) { return this.nodes.get(id) ?? null }
  out(id: string, _e?: string) { return this.edges.filter((e) => e.from === id).map((e) => this.nodes.get(e.to)).filter(Boolean) as MemoryNode[] }
  setProperty(id: string, key: string, value: unknown) { const n = this.nodes.get(id); if (n) n.properties[key] = value }
  setLti(id: string, lti: number) { this.ltiCalls.push({ id, lti }) }
}

function seed() {
  const s = new FakeStore()
  // a memory doc + its chunk (for preview)
  s.add('doc:mem1', ['Document'], { filename: 'memory/fact-2026.md', created_at: '2026-06-21T10:00:00Z' })
  s.add('chunk:mem1', ['DocumentChunk'], { text: 'Michael prefers concise answers.' })
  s.link('doc:mem1', 'chunk:mem1')
  s.add('doc:mem2', ['Document'], { filename: 'memory/identity-2026.md', created_at: '2026-06-21T11:00:00Z', preview: "Michael's title is Lord." })
  // a NON-memory document (must not appear)
  s.add('doc:report', ['Document'], { filename: 'reports/q1.md', created_at: '2026-06-20T09:00:00Z' })
  return s
}

test('listMemories returns only memory/* documents, with kind + preview', () => {
  const mems = listMemories(seed())
  assert.equal(mems.length, 2)
  assert.ok(!mems.some((m) => m.id === 'doc:report'))   // non-memory excluded
  const fact = mems.find((m) => m.id === 'doc:mem1')!
  assert.equal(fact.kind, 'fact')
  assert.match(fact.preview, /concise answers/)          // pulled from the linked chunk
  const id = mems.find((m) => m.id === 'doc:mem2')!
  assert.equal(id.kind, 'identity')
  assert.match(id.preview, /Lord/)
})

test('pinMemory raises LTI (injects into the long-term brain) and marks pinned', () => {
  const s = seed()
  assert.equal(pinMemory(s, 'doc:mem1'), true)
  const n = s.getNode('doc:mem1')!
  assert.equal(n.properties['pinned'], true)
  assert.equal(n.properties['lti'], PINNED_LTI)
  assert.deepEqual(s.ltiCalls.at(-1), { id: 'doc:mem1', lti: PINNED_LTI })   // LTI actually boosted on the atom
})

test('unpinMemory lowers LTI so it can decay out', () => {
  const s = seed()
  pinMemory(s, 'doc:mem1')
  assert.equal(unpinMemory(s, 'doc:mem1'), true)
  assert.equal(s.getNode('doc:mem1')!.properties['pinned'], false)
  assert.ok(Number(s.getNode('doc:mem1')!.properties['lti']) < PINNED_LTI)
})

test('pinned memories sort first', () => {
  const s = seed()
  pinMemory(s, 'doc:mem1')   // older but pinned
  const mems = listMemories(s)
  assert.equal(mems[0]!.id, 'doc:mem1')   // pinned floats to top despite older timestamp
})

test('pinning a non-memory node is refused', () => {
  const s = seed()
  assert.equal(pinMemory(s, 'doc:report'), false)
  assert.equal(pinMemory(s, 'nonexistent'), false)
})

test('forgetMemory soft-deletes — excluded from recall, LTI dropped', () => {
  const s = seed()
  assert.equal(listMemories(s).length, 2)
  assert.equal(forgetMemory(s, 'doc:mem1'), true)
  const after = listMemories(s)
  assert.equal(after.length, 1)
  assert.ok(!after.some((m) => m.id === 'doc:mem1'))   // gone from recall
  assert.equal(s.getNode('doc:mem1')!.properties['deleted'], true)
  assert.equal(forgetMemory(s, 'doc:report'), false)   // non-memory refused
})

test('findSimilarMemory catches near-duplicates (dedup-on-write)', () => {
  const s = seed()  // doc:mem1 preview = "Michael prefers concise answers."
  assert.equal(findSimilarMemory(s, 'Michael prefers concise short answers'), 'doc:mem1')   // near-dup
  assert.equal(findSimilarMemory(s, 'the weather in Tokyo is rainy'), null)                 // unrelated
})

test('selectRelevantMemories: pinned always in, unpinned only when relevant', () => {
  const s = new FakeStore()
  s.add('doc:coffee', ['Document'], { filename: 'memory/preference-1.md', created_at: '2026-06-21T10:00:00Z', preview: 'Michael prefers coffee in the morning' })
  s.add('doc:python', ['Document'], { filename: 'memory/fact-1.md', created_at: '2026-06-21T11:00:00Z', preview: 'Michael writes Python and Rust' })
  s.add('doc:title', ['Document'], { filename: 'memory/identity-1.md', created_at: '2026-06-21T12:00:00Z', preview: 'His title is Lord' })
  pinMemory(s, 'doc:title')  // pinned identity

  // query about python → python memory surfaces, coffee does NOT; pinned title always present
  const got = selectRelevantMemories(s, 'help me debug this python script', 8).map((m) => m.id)
  assert.ok(got.includes('doc:title'), 'pinned always included')
  assert.ok(got.includes('doc:python'), 'relevant unpinned surfaces')
  assert.ok(!got.includes('doc:coffee'), 'irrelevant unpinned excluded')   // the "ask weather, get coffee" fix

  // empty/unmatched query → pinned only (no irrelevant dump), then fill
  const weather = selectRelevantMemories(s, 'what is the weather today', 8).map((m) => m.id)
  assert.ok(weather.includes('doc:title'))   // pinned always
  assert.ok(!weather.includes('doc:coffee') && !weather.includes('doc:python'))  // nothing matched
})
