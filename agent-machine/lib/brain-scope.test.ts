/** Tests for the three-brain scope boundary. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BrainScope, KNOWLEDGE_SCOPES, ALL_SCOPES, isKnowledgeScope, isChatScope } from './brain-scope.js'

test('the three scopes are distinct', () => {
  assert.deepEqual([...ALL_SCOPES].sort(), ['academic', 'chat', 'operational'])
})

test('chat is NOT a knowledge scope (the no-pollution boundary)', () => {
  assert.equal(isChatScope(BrainScope.Chat), true)
  assert.equal(isKnowledgeScope(BrainScope.Chat), false)
  assert.ok(!KNOWLEDGE_SCOPES.includes(BrainScope.Chat))
})

test('academic and operational are the shippable knowledge scopes', () => {
  assert.equal(isKnowledgeScope(BrainScope.Academic), true)
  assert.equal(isKnowledgeScope(BrainScope.Operational), true)
  assert.deepEqual([...KNOWLEDGE_SCOPES].sort(), ['academic', 'operational'])
})
