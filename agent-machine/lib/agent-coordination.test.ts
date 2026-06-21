import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  claimFiles, releaseClaims, activeClaims, conflictsFor, coordinationBrief,
  type CoordStore, type CoordNode,
} from './agent-coordination.js'

class FakeStore implements CoordStore {
  nodes = new Map<string, CoordNode>()
  edges: Array<{ label: string; from: string; to: string }> = []
  getNode(id: string) { return this.nodes.get(id) ?? null }
  addNode(id: string, labels: string[], properties: Record<string, unknown>) {
    const n = this.nodes.get(id) ?? { id, labels, properties }
    if (!this.nodes.has(id)) this.nodes.set(id, n)
    return n
  }
  addEdge(label: string, from: string, to: string) { this.edges.push({ label, from, to }); return null }
  out(id: string, edgeLabel?: string) { return this.edges.filter((e) => e.from === id && (!edgeLabel || e.label === edgeLabel)).map((e) => this.nodes.get(e.to)).filter(Boolean) as CoordNode[] }
  nodesByLabel(label: string) { return [...this.nodes.values()].filter((n) => n.labels.includes(label)) }
}

const T0 = '2026-06-21T12:00:00.000Z'
const plus = (iso: string, ms: number) => new Date(Date.parse(iso) + ms).toISOString()

test('claimFiles grants free files', () => {
  const s = new FakeStore()
  const r = claimFiles(s, { agentId: 'agentA', sessionId: 's1', paths: ['/repo/server.ts', '/repo/util.ts'] }, T0)
  assert.deepEqual(r.granted.sort(), ['/repo/server.ts', '/repo/util.ts'])
  assert.equal(r.conflicts.length, 0)
})

test('a second agent is DENIED a file the first holds (the core rule)', () => {
  const s = new FakeStore()
  claimFiles(s, { agentId: 'agentA', sessionId: 's1', paths: ['/repo/server.ts'] }, T0)
  const r = claimFiles(s, { agentId: 'agentB', sessionId: 's2', paths: ['/repo/server.ts', '/repo/new.ts'] }, plus(T0, 1000))
  assert.deepEqual(r.granted, ['/repo/new.ts'])           // gets the free one
  assert.equal(r.conflicts.length, 1)
  assert.equal(r.conflicts[0]!.path, '/repo/server.ts')
  assert.equal(r.conflicts[0]!.heldBy, 'agentA')          // told who holds it
})

test('a claim expires after its TTL — no permanent locks (crash-safe)', () => {
  const s = new FakeStore()
  claimFiles(s, { agentId: 'agentA', sessionId: 's1', paths: ['/repo/x.ts'], ttlMs: 60_000 }, T0)
  // 2 minutes later, agentA is gone; agentB can claim it.
  const r = claimFiles(s, { agentId: 'agentB', sessionId: 's2', paths: ['/repo/x.ts'] }, plus(T0, 120_000))
  assert.deepEqual(r.granted, ['/repo/x.ts'])
  assert.equal(r.conflicts.length, 0)
})

test('releaseClaims frees a file for another agent immediately', () => {
  const s = new FakeStore()
  claimFiles(s, { agentId: 'agentA', sessionId: 's1', paths: ['/repo/y.ts'] }, T0)
  const released = releaseClaims(s, 'agentA', ['/repo/y.ts'], plus(T0, 1000))
  assert.equal(released, 1)
  const r = claimFiles(s, { agentId: 'agentB', sessionId: 's2', paths: ['/repo/y.ts'] }, plus(T0, 2000))
  assert.deepEqual(r.granted, ['/repo/y.ts'])
})

test('re-claiming your own file refreshes the TTL (heartbeat), no conflict', () => {
  const s = new FakeStore()
  claimFiles(s, { agentId: 'agentA', sessionId: 's1', paths: ['/repo/z.ts'], ttlMs: 60_000 }, T0)
  const r = claimFiles(s, { agentId: 'agentA', sessionId: 's1', paths: ['/repo/z.ts'], ttlMs: 60_000 }, plus(T0, 50_000))
  assert.deepEqual(r.granted, ['/repo/z.ts'])
  assert.equal(r.conflicts.length, 0)
  // still live well past the original TTL because it was refreshed
  assert.equal(conflictsFor(s, '/repo/z.ts', 'agentB', Date.parse(plus(T0, 90_000))).length, 1)
})

test('activeClaims + coordinationBrief give the shared who-touches-what view', () => {
  const s = new FakeStore()
  claimFiles(s, { agentId: 'agentA', sessionId: 's1', paths: ['/repo/server.ts'] }, T0)
  claimFiles(s, { agentId: 'agentB', sessionId: 's2', paths: ['/repo/graph.ts'], op: 'edit' }, T0)
  const live = activeClaims(s, plus(T0, 1000))
  assert.equal(live.length, 2)
  const brief = coordinationBrief(s, 'agentA', plus(T0, 1000))
  assert.match(brief, /graph\.ts — claimed by agentB/)
  assert.ok(!brief.includes('server.ts'))   // own claim not shown
})
