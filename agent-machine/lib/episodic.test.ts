import { test } from 'node:test'
import assert from 'node:assert/strict'
import { recallExchanges, formatExchanges, type ExchangeStore, type ExchangeNode } from './episodic.js'

class FakeStore implements ExchangeStore {
  nodes: ExchangeNode[] = []
  add(properties: Record<string, unknown>) { this.nodes.push({ id: `i${this.nodes.length}`, labels: ['Interaction'], properties }); return this }
  nodesByLabel(label: string) { return this.nodes.filter((n) => n.labels.includes(label)) }
}

function seed() {
  return new FakeStore()
    .add({ promptSummary: 'How do I configure the local Ollama runtime port?', responseSummary: 'Set NOETICA_OLLAMA_PORT — it defaults to 11435.', timestamp: '2026-06-20T10:00:00Z' })
    .add({ promptSummary: 'What is the capital of France?', responseSummary: 'Paris.', timestamp: '2026-06-20T11:00:00Z' })
    .add({ promptSummary: 'List my files', responseSummary: 'patterns:cache-augmented sources:1', timestamp: '2026-06-20T12:00:00Z' }) // routing metadata
    .add({ promptSummary: 'Old pruned one', responseSummary: 'irrelevant', timestamp: '2026-06-19T09:00:00Z', hygiene_pruned: true })
}

test('recallExchanges finds the relevant prior exchange, ranked', () => {
  const got = recallExchanges(seed(), 'help me set the ollama runtime port', { limit: 3 })
  assert.equal(got.length, 1)
  assert.match(got[0]!.question, /Ollama runtime port/)
  assert.match(got[0]!.answer, /11435/)
})

test('excludes routing-metadata answers, pruned atoms, and unrelated questions', () => {
  const got = recallExchanges(seed(), 'tell me about list files', { minScore: 0.05 })
  assert.ok(!got.some((e) => /patterns:/.test(e.answer)), 'no routing-metadata answers')
  assert.ok(!got.some((e) => e.question === 'Old pruned one'), 'no pruned atoms')
})

test('thin query returns nothing (no spurious recall)', () => {
  assert.deepEqual(recallExchanges(seed(), 'hi'), [])
})

test('excludeRunId skips the current turn', () => {
  const s = new FakeStore().add({ promptSummary: 'configure ollama port', responseSummary: 'use 11435', timestamp: '2026-06-20T10:00:00Z', runId: 'run-now' })
  assert.equal(recallExchanges(s, 'configure ollama port', { excludeRunId: 'run-now', minScore: 0.05 }).length, 0)
})

test('formatExchanges renders a block, empty when none', () => {
  assert.equal(formatExchanges([]), '')
  const block = formatExchanges([{ question: 'q', answer: 'a', ts: 't', score: 0.5 }])
  assert.match(block, /Prior related exchanges/)
  assert.match(block, /Earlier asked: "q" → answered: "a"/)
})
