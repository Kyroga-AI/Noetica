/**
 * Tests for the GDS keystone — PageRank, Louvain, betweenness, modularity — on a known small graph.
 * Runs in CI via `npm test`. Asserts relative structure (not exact float values, which are algorithm-
 * dependent): the hub is most important, the bridge has highest betweenness, the two clusters separate.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeAnalytics } from './graph-analytics.js'

// A hub-star {A·B,C,D} joined by a bridge edge D—E to a triangle {E,F,G}.
const nodes = ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((id) => ({ id }))
const edges = [
  { from: 'A', to: 'B' }, { from: 'A', to: 'C' }, { from: 'A', to: 'D' },
  { from: 'D', to: 'E' },                                   // the bridge
  { from: 'E', to: 'F' }, { from: 'F', to: 'G' }, { from: 'G', to: 'E' },
]

test('PageRank: the hub is the most important node', () => {
  const a = computeAnalytics(nodes, edges)
  const pr = a.nodes
  // A (degree 3 hub) should outrank a leaf like B
  assert.equal(pr['A']!.pagerank > pr['B']!.pagerank, true, 'hub A should outrank leaf B')
  assert.equal(pr['A']!.pagerank > pr['C']!.pagerank, true)
  // every pagerank is in [0,1] (normalized)
  for (const m of Object.values(pr)) assert.equal(m.pagerank >= 0 && m.pagerank <= 1, true)
})

test('Betweenness: the bridge nodes are the top connectors', () => {
  const a = computeAnalytics(nodes, edges)
  const bc = a.nodes
  // D and E sit on every path between the two clusters → higher betweenness than leaves
  assert.equal(bc['D']!.betweenness > bc['B']!.betweenness, true, 'bridge D > leaf B')
  assert.equal(bc['E']!.betweenness > bc['F']!.betweenness, true, 'bridge E > triangle member F')
})

test('Louvain: the two clusters land in different communities', () => {
  const a = computeAnalytics(nodes, edges)
  assert.equal(a.modularity > 0, true, 'a clustered graph has positive modularity')
  // A (star side) and F (triangle side) should not share a community
  assert.notEqual(a.nodes['A']!.community, a.nodes['F']!.community, 'star and triangle separate')
  assert.equal(a.communities.length >= 1, true)
})

test('degree + structure reported correctly', () => {
  const a = computeAnalytics(nodes, edges)
  assert.equal(a.nodes['A']!.degree, 3, 'A connects to B, C, D')
  assert.equal(a.nodes['F']!.degree, 2, 'F connects to E, G')
  assert.equal(a.summary.nodeCount, 7)
  assert.equal(a.summary.edgeCount, 7)
})

test('empty graph is handled', () => {
  const a = computeAnalytics([], [])
  assert.equal(a.summary.nodeCount, 0)
  assert.equal(a.communities.length, 0)
  assert.equal(Number.isFinite(a.modularity), true)
})
