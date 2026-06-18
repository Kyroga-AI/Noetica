import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pearson, analyzeDrivers, serializeQuality, hydrateQuality, worthTrend, resetQuality, type QualitySample } from './quality-sr.js'

test('pearson: perfect positive / negative / none', () => {
  assert.equal(pearson([1, 2, 3], [2, 4, 6]), 1)
  assert.equal(pearson([1, 2, 3], [6, 4, 2]), -1)
  assert.equal(pearson([1, 2, 3], [5, 5, 5]), 0) // no variance
})

function mk(worth: number, grounding: number, latency: number): QualitySample {
  return {
    worth, grounding, graph_grounding: grounding, belief_alignment: 0.5,
    latency_ms: latency, input_tokens: 500, provider: 'ollama', model: 'qwen2.5:7b',
    task: 'general', ts: new Date().toISOString(),
  }
}

test('analyzeDrivers identifies grounding as the dominant positive driver', () => {
  // worth tracks grounding exactly; latency is unrelated/constant-ish
  const samples = [mk(0.2, 0.2, 1000), mk(0.5, 0.5, 1000), mk(0.8, 0.8, 1000), mk(0.9, 0.9, 1000)]
  const r = analyzeDrivers(samples)
  assert.equal(r.samples, 4)
  assert.equal(r.drivers[0]!.feature, 'grounding')
  assert.ok(r.drivers[0]!.correlation > 0.9)
  assert.match(r.summary, /grounding/)
})

test('analyzeDrivers needs >= 3 samples', () => {
  const r = analyzeDrivers([mk(0.5, 0.5, 100), mk(0.6, 0.6, 100)])
  assert.equal(r.drivers.length, 0)
  assert.match(r.summary, /not enough/)
})

test('worthTrend: detects an upward compounding trend across time buckets', () => {
  // Worth rises over time; ts strictly increasing so chronological bucketing is exercised.
  const samples: QualitySample[] = []
  for (let i = 0; i < 20; i++) {
    samples.push({ ...mk(0.2 + i * 0.03, 0.5, 100), ts: `2026-06-18T00:00:${String(i).padStart(2, '0')}Z` })
  }
  const t = worthTrend(5, samples)
  assert.equal(t.buckets.length, 5)
  assert.ok(t.delta > 0.02, `delta ${t.delta} should be positive`)
  assert.equal(t.improving, true)
  assert.ok(t.buckets[4]!.avg_worth > t.buckets[0]!.avg_worth)
})

test('worthTrend: returns empty buckets below threshold', () => {
  const t = worthTrend(5, [mk(0.5, 0.5, 100)])
  assert.equal(t.buckets.length, 0)
  assert.equal(t.improving, false)
})

test('resetQuality clears the corpus', () => {
  hydrateQuality(JSON.stringify([{ worth: 0.5, grounding: 0.5, graph_grounding: 0.5, belief_alignment: 0.5, latency_ms: 1, input_tokens: 1, provider: 'o', model: 'm', task: 't', ts: '2026' }]))
  assert.ok(resetQuality() >= 1)
})

test('serialize → hydrate round-trips quality samples (persistence)', () => {
  const s = { worth: 0.7, grounding: 0.6, graph_grounding: 0.5, belief_alignment: 0.4, latency_ms: 100, input_tokens: 200, provider: 'ollama', model: 'm', task: 't', ts: '2026' }
  assert.ok(hydrateQuality(JSON.stringify([s])) >= 1)
  assert.match(serializeQuality(), /0.7/)
})
