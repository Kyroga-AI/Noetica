/** Tests for AG-UI protocol conformance (Agent-User Interaction Protocol). */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runStarted, textMessageContent, toolCallStart, isValidEvent, toSSE, buildTextRun, isWellFormedRun, stateDelta } from './ag-ui.js'

test('factories produce valid, contract-conformant events', () => {
  assert.equal(isValidEvent(runStarted('t1', 'r1')), true)
  assert.equal(isValidEvent(textMessageContent('m1', 'hello')), true)
  assert.equal(isValidEvent(toolCallStart('tc1', 'search')), true)
  assert.equal(isValidEvent({ type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1' } as never), false, 'missing delta → invalid')
})

test('toSSE emits a plain AG-UI data frame', () => {
  const frame = toSSE(runStarted('t', 'r'))
  assert.equal(frame.startsWith('data: '), true)
  assert.equal(frame.endsWith('\n\n'), true)
  assert.deepEqual(JSON.parse(frame.slice(6).trim()), { type: 'RUN_STARTED', threadId: 't', runId: 'r' })
})

test('buildTextRun is a well-formed run (start→message→end→finish)', () => {
  const run = buildTextRun('t1', 'r1', 'm1', ['Hel', 'lo'])
  assert.equal(run[0]!.type, 'RUN_STARTED')
  assert.equal(run[run.length - 1]!.type, 'RUN_FINISHED')
  assert.equal(isWellFormedRun(run), true)
})

test('isWellFormedRun rejects an unbracketed message + a missing terminator', () => {
  assert.equal(isWellFormedRun([runStarted('t', 'r'), textMessageContent('m1', 'x')]), false, 'content without START + no FINISH')
  assert.equal(isWellFormedRun([{ type: 'TEXT_MESSAGE_START', messageId: 'm', role: 'assistant' }]), false, 'no RUN_STARTED first')
})

test('stateDelta carries an RFC-6902 JSON Patch', () => {
  const e = stateDelta([{ op: 'replace', path: '/graph/selected', value: 'node-1' }])
  assert.equal(e.type, 'STATE_DELTA')
  assert.equal(Array.isArray(e['delta']), true)
})

test('HARDENING: isWellFormedRun balances tool calls + rejects duplicate START / second RUN_STARTED', () => {
  const ok = [runStarted('t', 'r'), toolCallStart('tc1', 'search'), { type: 'TOOL_CALL_ARGS', toolCallId: 'tc1', delta: '{}' }, { type: 'TOOL_CALL_END', toolCallId: 'tc1' }, { type: 'RUN_FINISHED', threadId: 't', runId: 'r' }]
  assert.equal(isWellFormedRun(ok as never), true)
  const unbalanced = [runStarted('t', 'r'), toolCallStart('tc1', 'search'), { type: 'RUN_FINISHED', threadId: 't', runId: 'r' }]
  assert.equal(isWellFormedRun(unbalanced as never), false, 'TOOL_CALL_START with no END')
  const orphanArgs = [runStarted('t', 'r'), { type: 'TOOL_CALL_ARGS', toolCallId: 'x', delta: '{}' }, { type: 'RUN_FINISHED', threadId: 't', runId: 'r' }]
  assert.equal(isWellFormedRun(orphanArgs as never), false, 'ARGS for unopened tool')
})
