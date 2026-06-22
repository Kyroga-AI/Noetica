/** Tests for the graph surface lenses — exhaust exclusion + the revived Memory(document) lens. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cleanLabel, isExhaust, selectSurface } from './graph-surface.js'

const node = (id: string, labels: string[], properties: Record<string, unknown> = {}) =>
  ({ id, labels, properties }) as never

test('isExhaust flags LearningState / attention / self-state telemetry', () => {
  assert.equal(isExhaust(node('urn:noetica:learning:capabilities', ['LearningState'])), true)
  assert.equal(isExhaust(node('urn:x:attention', ['AttentionSnapshot'])), true)
  assert.equal(isExhaust(node('urn:noetica:doc:readme', ['Document'])), false)
})

test('cleanLabel returns null for exhaust → excluded from every clean-set lens + analytics', () => {
  assert.equal(cleanLabel(node('urn:noetica:learning:quality', ['LearningState'], { title: 'quality' })), null)
})

test('cleanLabel revives Document/RECORD nodes from path-shaped filenames (the dead Memory lens)', () => {
  // memory/curation-<stamp>.md → "curation" (was rejected as hashy/prose → null → lens empty)
  assert.equal(cleanLabel(node('urn:noetica:doc:mem1', ['Document'], { filename: 'memory/curation-20260622-abc.md' })), 'curation')
  assert.equal(cleanLabel(node('urn:noetica:doc:c1', ['Conversation'], { filename: 'chats/Project Kickoff.md' })), 'Project Kickoff')
})

test('memory lens returns Document nodes (was 0 before the fix)', () => {
  const nodes = [
    node('d1', ['Document'], { filename: 'memory/curation-20260101-x.md' }),
    node('d2', ['Document'], { filename: 'memory/insight-20260102-y.md' }),
    node('ls', ['LearningState'], { title: 'capabilities' }),   // exhaust — must NOT appear
  ]
  const edges = [{ from: 'd1', to: 'd2' }] as never
  const res = selectSurface(nodes, edges, { view: 'memory', limit: 20 })
  const ids = res.nodes.map((n) => n.id)
  assert.ok(ids.includes('d1') && ids.includes('d2'), 'memory lens surfaces Document nodes')
  assert.ok(!ids.includes('ls'), 'LearningState exhaust excluded from the lens')
})
