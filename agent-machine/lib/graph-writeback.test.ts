/** Tests for HellGraph write-back — uses a fake WritableGraph store (no live HellGraph needed). */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { persistProposals, persistInferred, type WritableGraph } from './graph-writeback.js'
import { proposalsFromInferred, setStatus } from './graph-proposals.js'

function fakeStore() {
  const nodes = new Map<string, { labels: string[]; props: Record<string, unknown> }>()
  const edges: Array<{ from: string; to: string; label: string; props: Record<string, unknown> }> = []
  const store: WritableGraph = {
    getNode: (id) => nodes.get(id),
    addNode: (id, labels, props) => { nodes.set(id, { labels, props }) },
    addEdge: (label, from, to, props) => { edges.push({ from, to, label, props }) },
    allEdges: () => edges.map((e) => ({ from: e.from, to: e.to, label: e.label })),
  }
  return { store, nodes, edges }
}

test('persistProposals writes accepted add-edge to HellGraph, creating endpoints + provenance', () => {
  const { store, nodes, edges } = fakeStore()
  let props = proposalsFromInferred([{ subject: 'A', predicate: 'depends on', object: 'C', via: 'B', verified: true }])
  props = setStatus(props, props[0]!.id, 'accepted')
  const r = persistProposals(props, { store, now: 'T' })
  assert.equal(r.written, 1)
  assert.equal(edges.length, 1)
  assert.equal(edges[0]!.from, 'A'); assert.equal(edges[0]!.to, 'C')
  assert.equal(edges[0]!.props.epistemic, 'inferred', 'provenance tagged')
  assert.ok(nodes.has('A') && nodes.has('C'), 'endpoints created')
})

test('persistProposals is idempotent — existing edge skipped', () => {
  const { store } = fakeStore()
  let props = proposalsFromInferred([{ subject: 'A', predicate: 'rel', object: 'B' }])
  props = setStatus(props, props[0]!.id, 'accepted')
  assert.equal(persistProposals(props, { store }).written, 1)
  assert.equal(persistProposals(props, { store }).written, 0, 're-applying writes nothing')
  assert.equal(persistProposals(props, { store }).skipped, 1)
})

test('persistProposals ignores non-accepted proposals', () => {
  const { store, edges } = fakeStore()
  const props = proposalsFromInferred([{ subject: 'X', predicate: 'rel', object: 'Y' }])   // still pending
  assert.equal(persistProposals(props, { store }).written, 0)
  assert.equal(edges.length, 0)
})

test('HARDENING: invalid ids / edge labels are rejected (no junk into the canonical graph)', () => {
  const { store, edges } = fakeStore()
  const bad = [
    { ...proposalsFromInferred([{ subject: 'A', predicate: 'rel', object: 'B' }])[0]!, status: 'accepted' as const, payload: { from: 'A'.repeat(300), to: 'B', rel: 'rel' } },   // id too long
    { ...proposalsFromInferred([{ subject: 'A', predicate: 'rel', object: 'B' }])[0]!, status: 'accepted' as const, payload: { from: 'A', to: 'B', rel: 'evil\nINJECT' } },         // rel with newline
    { ...proposalsFromInferred([{ subject: 'A', predicate: 'rel', object: 'B' }])[0]!, status: 'accepted' as const, payload: { from: 'A', to: 'B', rel: 'ok_rel' } },               // valid
  ]
  const r = persistProposals(bad, { store })
  assert.equal(r.written, 1, 'only the valid edge is written')
  assert.equal(edges.length, 1)
  assert.equal(edges[0]!.label, 'ok_rel')
})

test('persistInferred persists ONLY verified facts (GAIA invariant)', () => {
  const { store, edges } = fakeStore()
  const r = persistInferred([
    { subject: 'A', predicate: 'rel', object: 'B', verified: true },
    { subject: 'C', predicate: 'rel', object: 'D', verified: false },   // unverified → NOT written
  ], { store })
  assert.equal(r.written, 1)
  assert.equal(edges.length, 1)
  assert.equal(edges[0]!.from, 'A', 'only the verified inference reached HellGraph')
})
