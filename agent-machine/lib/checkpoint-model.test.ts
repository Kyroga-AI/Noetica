import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildResumeMessages, type RunCheckpoint } from './checkpoint-model.js'

const base: RunCheckpoint = {
  id: 'cp1', run_id: 'r1', session_id: 's', status: 'interrupted',
  model: 'qwen2.5:7b', provider: 'ollama',
  messages: [{ role: 'user', content: 'Explain TCP handshake' }],
  partial_content: 'The TCP handshake begins with SYN', partial_thinking: '', created_at: '',
}

test('buildResumeMessages replays partial output and adds a continue instruction', () => {
  const msgs = buildResumeMessages(base)
  assert.equal(msgs.length, 3)
  assert.equal(msgs[0]!.role, 'user')
  assert.equal(msgs[1]!.role, 'assistant')
  assert.equal(msgs[1]!.content, 'The TCP handshake begins with SYN')
  assert.match(msgs[2]!.content, /Continue your previous response/)
})

test('buildResumeMessages folds in added context', () => {
  const msgs = buildResumeMessages(base, 'Focus on the SYN-ACK step')
  assert.match(msgs[2]!.content, /Focus on the SYN-ACK step/)
})

test('buildResumeMessages with no partial content but added context appends a user turn', () => {
  const msgs = buildResumeMessages({ ...base, partial_content: '' }, 'new info')
  assert.equal(msgs.length, 2)
  assert.match(msgs[1]!.content, /Additional context/)
})

test('buildResumeMessages with nothing to add returns the original messages', () => {
  const msgs = buildResumeMessages({ ...base, partial_content: '' })
  assert.equal(msgs.length, 1)
})
