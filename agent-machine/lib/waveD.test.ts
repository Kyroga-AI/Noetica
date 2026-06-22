/** Wave-3 Batch D — memory/knowledge: procedural-memory, dreaming, link-suggest, mind-map, datalog-lite. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { distillSkill, recordUse, successRate, retrieveSkills } from './procedural-memory.js'
import { dreamEdges, type Edge } from './dreaming.js'
import { suggestLinks } from './link-suggest.js'
import { buildMindMap, flattenOutline, countNodes } from './mind-map.js'
import { evaluate, type Rule, type Fact } from './datalog-lite.js'

test('procedural-memory: distill, record success, retrieve by relevance×success', () => {
  let s = distillSkill('deploy the app', 'run build then deploy script', ['build', 'deploy'])
  s = recordUse(recordUse(s, true), true)
  assert.equal(successRate(s), 1)
  const got = retrieveSkills('deploy', [s], (a, b) => (b.includes('deploy') || a.includes('deploy') ? 0.9 : 0))
  assert.equal(got.length, 1)
})

test('dreaming: random walk proposes a novel non-adjacent edge', () => {
  const adj = new Map<string, Edge[]>([['A', [{ to: 'B', rel: 'r' }]], ['B', [{ to: 'C', rel: 'r' }]], ['C', [{ to: 'D', rel: 'r' }]]])
  const proposed = dreamEdges(adj, ['A'], () => 0, { length: 3, walksPerSeed: 1 })   // A→B→C→D
  assert.equal(proposed.some((e) => (e.from === 'A' && e.to === 'D')), true, 'A..D is novel (not directly linked)')
})

test('link-suggest: ranks similar nodes, excludes already-linked', () => {
  const cands = [
    { id: '1', label: 'auth', vec: [1, 0, 0] },
    { id: '2', label: 'login', vec: [0.95, 0.1, 0] },
    { id: '3', label: 'cooking', vec: [0, 0, 1] },
  ]
  const sug = suggestLinks([1, 0, 0], cands, { minSim: 0.5, alreadyLinked: new Set(['1']) })
  assert.equal(sug[0]!.id, '2')
  assert.equal(sug.some((s) => s.id === '1'), false, 'already-linked excluded')
  assert.equal(sug.some((s) => s.id === '3'), false, 'dissimilar excluded')
})

test('mind-map: builds a tree, flattens with depth, counts nodes', () => {
  const tree = buildMindMap('root', [{ parent: 'root', child: 'a' }, { parent: 'root', child: 'b' }, { parent: 'a', child: 'a1' }])
  assert.equal(countNodes(tree), 4)
  const outline = flattenOutline(tree)
  assert.equal(outline.find((o) => o.topic === 'a1')!.depth, 2)
})

test('datalog-lite: recursive ancestor + negation-as-failure', () => {
  const facts: Fact[] = [{ pred: 'parent', args: ['a', 'b'] }, { pred: 'parent', args: ['b', 'c'] }, { pred: 'person', args: ['a'] }, { pred: 'person', args: ['x'] }]
  const rules: Rule[] = [
    { head: { pred: 'ancestor', terms: ['X', 'Y'] }, body: [{ pred: 'parent', terms: ['X', 'Y'] }] },
    { head: { pred: 'ancestor', terms: ['X', 'Z'] }, body: [{ pred: 'parent', terms: ['X', 'Y'] }, { pred: 'ancestor', terms: ['Y', 'Z'] }] },
    { head: { pred: 'orphan', terms: ['P'] }, body: [{ pred: 'person', terms: ['P'] }, { pred: 'parent', terms: ['Q', 'P'], neg: true }] },
  ]
  const all = evaluate(facts, rules)
  assert.equal(all.some((f) => f.pred === 'ancestor' && f.args[0] === 'a' && f.args[1] === 'c'), true, 'transitive ancestor derived')
  assert.equal(all.some((f) => f.pred === 'orphan' && f.args[0] === 'x'), true, 'x has no parent → orphan')
  assert.equal(all.some((f) => f.pred === 'orphan' && f.args[0] === 'b'), false, 'b has a parent → not orphan')
})
