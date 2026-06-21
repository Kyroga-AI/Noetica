import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  extractFileOntology, ensureSession, recordTurnAtom, buildSessionContext, advanceGoalFromOutcome,
  type GraphStore, type GraphNodeLike,
} from './session-graph.js'

// Minimal in-memory store satisfying the GraphStore interface.
class FakeStore implements GraphStore {
  nodes = new Map<string, GraphNodeLike>()
  edges: Array<{ label: string; from: string; to: string; props: Record<string, unknown> }> = []
  getNode(id: string) { return this.nodes.get(id) ?? null }
  addNode(id: string, labels: string[], properties: Record<string, unknown>) {
    const n = this.nodes.get(id) ?? { id, labels, properties }
    if (!this.nodes.has(id)) this.nodes.set(id, n)
    return n
  }
  addEdge(label: string, from: string, to: string, props: Record<string, unknown> = {}) { this.edges.push({ label, from, to, props }); return null }
  out(id: string, edgeLabel?: string) {
    return this.edges.filter((e) => e.from === id && (!edgeLabel || e.label === edgeLabel)).map((e) => this.nodes.get(e.to)).filter(Boolean) as GraphNodeLike[]
  }
}

test('extractFileOntology pulls python defs/classes/imports', () => {
  const o = extractFileOntology('foo.py', 'import os\nfrom collections import deque\ndef bar(x):\n    return x\nclass Baz:\n    pass')
  assert.equal(o.language, 'python')
  assert.ok(o.symbols.some((s) => s.name === 'bar' && s.kind === 'function'))
  assert.ok(o.symbols.some((s) => s.name === 'Baz' && s.kind === 'class'))
  assert.ok(o.imports.includes('os') && o.imports.includes('collections'))
})

test('extractFileOntology pulls ts functions/exports/imports', () => {
  const o = extractFileOntology('m.ts', `import { x } from 'react'\nexport function foo() {}\nexport const bar = async () => {}\nclass Q {}`)
  assert.equal(o.language, 'typescript')
  assert.ok(o.symbols.some((s) => s.name === 'foo'))
  assert.ok(o.symbols.some((s) => s.name === 'bar'))
  assert.ok(o.symbols.some((s) => s.name === 'Q'))
  assert.ok(o.imports.includes('react'))
})

test('ensureSession creates a Session atom', () => {
  const s = new FakeStore()
  ensureSession(s, 'sess1')
  const n = s.getNode('urn:noetica:session:sess1')
  assert.ok(n)
  assert.ok(n!.labels.includes('Session'))
})

test('recordTurnAtom writes Turn + TOUCHED + Symbol atoms and edges', () => {
  const s = new FakeStore()
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sg-')), 'svc.ts')
  fs.writeFileSync(f, `export function login() {}\nexport function logout() {}`)
  recordTurnAtom(s, { sessionId: 'sess1', turnNum: 0, intent: 'fix_debug', model: 'qwen2.5-coder:7b', userText: 'fix the bug', answerText: 'done', filesTouched: [{ path: f, op: 'edit' }] })

  const turn = s.getNode('urn:noetica:turn:sess1:0')
  assert.ok(turn && turn.labels.includes('Turn'))
  // Session ─HAS_TURN→ Turn
  assert.ok(s.out('urn:noetica:session:sess1', 'HAS_TURN').some((n) => n.id === turn!.id))
  // Turn ─TOUCHED→ File
  const touched = s.out(turn!.id, 'TOUCHED')
  assert.equal(touched.length, 1)
  assert.ok(touched[0]!.labels.includes('File'))
  // File ─HAS_SYMBOL→ Symbol (login, logout)
  const syms = s.out(touched[0]!.id, 'HAS_SYMBOL').map((n) => n.properties['name'])
  assert.ok(syms.includes('login') && syms.includes('logout'))
})

test('buildSessionContext re-derives a brief from atoms (turns + files + symbols)', () => {
  const s = new FakeStore()
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sg2-')), 'auth.py')
  fs.writeFileSync(f, 'def authenticate(u):\n    return True')
  recordTurnAtom(s, { sessionId: 'sX', turnNum: 0, intent: 'build_implement', userText: 'add auth', answerText: 'added', filesTouched: [{ path: f, op: 'write' }] })
  const ctx = buildSessionContext(s, 'sX')
  assert.match(ctx, /Session memory/)
  assert.match(ctx, /Recent turns/)
  assert.match(ctx, /auth\.py/)
  assert.match(ctx, /authenticate/)   // the symbol ontology is surfaced
})

test('buildSessionContext is empty for an unknown session', () => {
  assert.equal(buildSessionContext(new FakeStore(), 'nope'), '')
})

test('advanceGoalFromOutcome marks a subtask done and fills a slot', () => {
  const goal = {
    objective: 'build login',
    subtasks: [{ title: 'implement password hashing', done: false }, { title: 'write tests', done: false }],
    slots: [{ name: 'database', filled: false }],
  }
  const changed = advanceGoalFromOutcome(goal, 'I implemented password hashing with bcrypt and connected the database.', [])
  assert.ok(changed >= 1)
  assert.equal(goal.subtasks[0]!.done, true)        // "password hashing" evidenced
  assert.equal(goal.subtasks[1]!.done, false)       // "write tests" not evidenced
  assert.equal(goal.slots[0]!.filled, true)         // "database" mentioned
})
