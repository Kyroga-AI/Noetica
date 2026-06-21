import { test } from 'node:test'
import assert from 'node:assert/strict'
import { graphSearch, jaccard, cosineSim, tokensOf, type SearchStore, type SearchNode } from './graph-search.js'

class FakeStore implements SearchStore {
  nodes = new Map<string, SearchNode>()
  edges: Array<{ from: string; to: string }> = []
  add(id: string, labels: string[], properties: Record<string, unknown>) { this.nodes.set(id, { id, labels, properties }); return this }
  link(from: string, to: string) { this.edges.push({ from, to }); return this }
  nodesByLabel(label: string) { return [...this.nodes.values()].filter((n) => n.labels.includes(label)) }
  out(id: string) { return this.edges.filter((e) => e.from === id).map((e) => this.nodes.get(e.to)).filter(Boolean) as SearchNode[] }
  in(id: string) { return this.edges.filter((e) => e.to === id).map((e) => this.nodes.get(e.from)).filter(Boolean) as SearchNode[] }
}

test('jaccard + cosine primitives', () => {
  assert.equal(jaccard(tokensOf('hospital ward'), tokensOf('hospital ward')), 1)
  assert.equal(jaccard(tokensOf('alpha'), tokensOf('beta')), 0)
  assert.ok(cosineSim([1, 0], [1, 0]) > 0.99)
  assert.ok(Math.abs(cosineSim([1, 0], [0, 1])) < 0.01)
})

test('the Hospital Way case: a company linked to "hospital" surfaces for a hospital search', () => {
  const s = new FakeStore()
  // the topic/term the query lexically matches
  s.add('term:hospital', ['GlossaryTerm'], { term: 'hospital' })
  // a company instance whose surface form does NOT contain "hospital", but is LINKED to it
  s.add('ent:acme', ['CanonicalEntity'], { surface: 'Acme Diagnostics', name: 'Acme Diagnostics' })
  s.link('term:hospital', 'ent:acme')   // hospital --(MENTIONS/LOCATED_ON)--> Acme
  // an unrelated entity that must NOT surface
  s.add('ent:zeta', ['CanonicalEntity'], { surface: 'Zeta Bakery' })

  const hits = graphSearch(s, 'hospital')
  const ids = hits.map((h) => h.id)
  assert.ok(ids.includes('term:hospital'), 'direct lexical match present')
  const acme = hits.find((h) => h.id === 'ent:acme')
  assert.ok(acme, 'the linked company surfaces for "hospital"')   // ← the user\'s requirement
  assert.equal(acme!.via, 'link')                                  // surfaced via link expansion
  assert.ok(!ids.includes('ent:zeta'), 'unrelated entity does not surface')
  // direct match outranks the link-expanded instance
  assert.ok(hits[0]!.id === 'term:hospital')
})

test('Jaccard surface-form match on instances (no link needed)', () => {
  const s = new FakeStore()
  s.add('ent:1', ['CanonicalEntity'], { surface: 'Mercy Hospital Group' })
  s.add('ent:2', ['CanonicalEntity'], { surface: 'Riverside Hospital' })
  s.add('ent:3', ['CanonicalEntity'], { surface: 'Downtown Bakery' })
  const hits = graphSearch(s, 'hospital')
  const ids = hits.map((h) => h.id)
  assert.ok(ids.includes('ent:1') && ids.includes('ent:2'))
  assert.ok(!ids.includes('ent:3'))
})

test('cosine path: vector-aligned atom surfaces even without token overlap', () => {
  const s = new FakeStore()
  s.add('topic:cardio', ['Topic'], { top_terms: 'cardiology heart' })
  const vecs: Record<string, number[]> = { 'topic:cardio': [0.9, 0.1, 0] }
  const hits = graphSearch(s, 'oncology', {
    queryVector: [0.88, 0.12, 0.01],          // semantically near cardio in this toy space
    vectorOf: (n) => vecs[n.id] ?? null,
  })
  const hit = hits.find((h) => h.id === 'topic:cardio')
  assert.ok(hit, 'cosine surfaced a topic with no shared tokens')
  assert.equal(hit!.via, 'cosine')
})

test('empty query returns nothing', () => {
  assert.deepEqual(graphSearch(new FakeStore(), '   '), [])
})
