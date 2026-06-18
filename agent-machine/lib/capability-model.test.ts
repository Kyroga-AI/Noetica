import { test } from 'node:test'
import assert from 'node:assert/strict'
import { recordCapability, capabilitySummary, capabilityHint, recordReward, selectArmUCB, serializeCapabilities, hydrateCapabilities, banditStandings, resetCapabilities } from './capability-model.js'

test('records success/error rates and latency per task/model', () => {
  const task = `unit-${Math.random().toString(36).slice(2)}`
  for (let i = 0; i < 8; i++) recordCapability({ task, provider: 'ollama', model: 'qwen2.5:7b', latencyMs: 1000, error: false })
  for (let i = 0; i < 2; i++) recordCapability({ task, provider: 'ollama', model: 'qwen2.5:7b', latencyMs: 1000, error: true })
  const row = capabilitySummary().find((r) => r.task === task && r.model === 'qwen2.5:7b')
  assert.ok(row)
  assert.equal(row!.runs, 10)
  assert.equal(row!.success_rate, 0.8)
  assert.equal(row!.is_local, true)
})

test('capabilityHint recommends escalation when local success is poor over enough runs', () => {
  const task = `poor-${Math.random().toString(36).slice(2)}`
  for (let i = 0; i < 10; i++) recordCapability({ task, provider: 'ollama', model: 'qwen2.5:7b', latencyMs: 500, error: i < 7 }) // 30% success
  const hint = capabilityHint(task)
  assert.equal(hint.recommendEscalation, true)
  assert.ok((hint.localSuccessRate ?? 1) < 0.6)
})

test('capabilityHint does NOT escalate without enough signal', () => {
  const task = `sparse-${Math.random().toString(36).slice(2)}`
  recordCapability({ task, provider: 'ollama', model: 'qwen2.5:7b', latencyMs: 500, error: true })
  const hint = capabilityHint(task)
  assert.equal(hint.recommendEscalation, false) // only 1 run < MIN_RUNS
})

// ── Bandit (UCB1) ────────────────────────────────────────────────────────────
test('selectArmUCB explores an untried arm before exploiting', () => {
  const task = `bandit-${Math.random().toString(36).slice(2)}`
  // arm A has reward history, arm B has none → B must be explored first
  recordReward({ task, provider: 'ollama', model: 'modelA', reward: 0.9 })
  const pick = selectArmUCB(task, ['modelA', 'modelB'])
  assert.equal(pick, 'modelB')
})

test('selectArmUCB exploits the higher-reward arm once both are explored', () => {
  const task = `bandit-${Math.random().toString(36).slice(2)}`
  for (let i = 0; i < 20; i++) recordReward({ task, provider: 'ollama', model: 'good', reward: 0.9 })
  for (let i = 0; i < 20; i++) recordReward({ task, provider: 'ollama', model: 'bad', reward: 0.1 })
  assert.equal(selectArmUCB(task, ['good', 'bad']), 'good')
})

test('selectArmUCB handles single/zero candidates', () => {
  assert.equal(selectArmUCB('t', []), undefined)
  assert.equal(selectArmUCB('t', ['only']), 'only')
})

test('banditStandings marks the leading arm per task', () => {
  const task = `stand-${Math.random().toString(36).slice(2)}`
  for (let i = 0; i < 5; i++) recordReward({ task, provider: 'ollama', model: 'win', reward: 0.9 })
  for (let i = 0; i < 5; i++) recordReward({ task, provider: 'ollama', model: 'lose', reward: 0.2 })
  const standings = banditStandings().filter((a) => a.task === task)
  assert.equal(standings.length, 2)
  const win = standings.find((a) => a.model === 'win')!
  assert.equal(win.leading, true)
  assert.equal(standings.find((a) => a.model === 'lose')!.leading, false)
  assert.ok(win.mean_reward > 0.8 && win.plays === 5)
})

test('resetCapabilities clears the self-model', () => {
  recordReward({ task: 'tmp', provider: 'ollama', model: 'm', reward: 0.5 })
  assert.ok(resetCapabilities() >= 1)
  assert.equal(banditStandings().length, 0)
})

test('serialize → hydrate round-trips capability rows (persistence)', () => {
  const json = JSON.stringify([{ task: 'rt-task', provider: 'ollama', model: 'm1', runs: 5, errors: 1, totalLatencyMs: 500, totalCostUsd: 0, totalReward: 2, rewardCount: 3, lastUpdated: '' }])
  assert.equal(hydrateCapabilities(json), 1)
  const row = capabilitySummary().find((r) => r.task === 'rt-task' && r.model === 'm1')
  assert.ok(row)
  assert.equal(row!.runs, 5)
  assert.match(serializeCapabilities(), /rt-task/)
})
