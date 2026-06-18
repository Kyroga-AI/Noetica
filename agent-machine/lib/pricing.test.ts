import { test } from 'node:test'
import assert from 'node:assert/strict'
import { estimateCostUsd, tokensEgressed, isLocalProvider } from '../../lib/pricing/modelPricing.js'

test('local providers cost $0 and egress 0 tokens', () => {
  assert.equal(isLocalProvider('ollama'), true)
  assert.equal(estimateCostUsd({ provider: 'ollama', model: 'qwen2.5:7b', inputTokens: 5000, outputTokens: 5000 }), 0)
  assert.equal(tokensEgressed({ provider: 'ollama', inputTokens: 5000, outputTokens: 5000 }), 0)
})

test('cloud providers compute non-zero cost + full egress', () => {
  const cost = estimateCostUsd({ provider: 'anthropic', model: 'claude-opus-4-8', inputTokens: 1_000_000, outputTokens: 0 })
  assert.equal(cost, 15) // opus input = $15/1M
  assert.equal(tokensEgressed({ provider: 'openai', inputTokens: 100, outputTokens: 50 }), 150)
})

test('unknown provider is treated as free rather than fabricating a price', () => {
  assert.equal(estimateCostUsd({ provider: 'mystery', model: 'x', inputTokens: 1_000_000, outputTokens: 1_000_000 }), 0)
})
