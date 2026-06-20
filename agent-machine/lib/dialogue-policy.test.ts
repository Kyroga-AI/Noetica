import { test } from 'node:test'
import assert from 'node:assert'
import { decidePolicy, decideEscalation } from './dialogue-policy.js'
import type { IntentPlan } from './intent-router.js'

function plan(p: Partial<IntentPlan>): IntentPlan {
  return { id: 0, name: 'build_implement', model: 'reasoning', retrieval: 'kb', slots: ['target', 'requirements'], tools: [], surface: 'code', skill: 'coding-agent', score: 2, ...p }
}

test('form-gated intent clarifies on a bare cue, proceeds with content', () => {
  const bare = decidePolicy(plan({}), 'build it', { hasDoc: false, entities: [] })
  assert.equal(bare.action, 'clarify')
  const withTarget = decidePolicy(plan({}), 'build the auth login form', { hasDoc: false, entities: [] })
  assert.equal(withTarget.action, 'proceed')
})

test('low-confidence no-doc turn falls back to clarify', () => {
  const d = decidePolicy(plan({ name: 'general', score: 0, slots: [] }), 'hmm what about that thing', { hasDoc: false, entities: [] })
  assert.equal(d.action, 'clarify')
})

test('escalates after 2 unresolved turns', () => {
  const e = decideEscalation({ intentScore: 2, consecutiveUnresolved: 2, hasAnthropic: false, hasOpenAI: false, availableModels: ['qwen2.5:7b', 'deepseek-r1:8b'], currentModel: 'qwen2.5:7b' })
  assert.equal(e.escalate, true)
  assert.equal(e.model, 'deepseek-r1:8b') // climbs the local ladder
})

test('escalates after 1 turn when intent confidence is low', () => {
  const e = decideEscalation({ intentScore: 0.8, consecutiveUnresolved: 0, hasAnthropic: true, hasOpenAI: false, availableModels: [], currentModel: 'qwen2.5:7b' })
  assert.equal(e.escalate, true)
  assert.equal(e.provider, 'anthropic')
  assert.equal(e.model, 'claude-sonnet-4-6') // prefers capable cloud when a key exists
})

test('does not escalate when confident and not struggling', () => {
  const e = decideEscalation({ intentScore: 2.5, consecutiveUnresolved: 0, hasAnthropic: true, hasOpenAI: false, availableModels: [], currentModel: 'qwen2.5:7b' })
  assert.equal(e.escalate, false)
})
