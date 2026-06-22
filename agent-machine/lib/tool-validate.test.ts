import { test } from 'node:test'
import assert from 'node:assert/strict'
import { repairToolArgs, validateToolCall, type ToolParamSchema } from './tool-validate.js'

test('repair: clean JSON parses direct (not flagged repaired)', () => {
  const r = repairToolArgs('{"path": "a.ts", "n": 3}')
  assert.equal(r.method, 'direct')
  assert.equal(r.repaired, false)
  assert.deepEqual(r.value, { path: 'a.ts', n: 3 })
})

test('repair: Python literals True/False/None → JSON', () => {
  const r = repairToolArgs('{"recursive": True, "force": False, "limit": None}')
  assert.equal(r.value?.['recursive'], true)
  assert.equal(r.value?.['force'], false)
  assert.equal(r.value?.['limit'], null)
  assert.equal(r.repaired, true)
})

test('repair: strips code fence + leading prose', () => {
  const r = repairToolArgs('Sure! ```json\n{"q": "hospital"}\n```')
  assert.deepEqual(r.value, { q: 'hospital' })
  assert.equal(r.repaired, true)
})

test('repair: closes a truncated object (balanced fallback)', () => {
  const r = repairToolArgs('{"command": "ls -la", "cwd": "/tmp"')   // missing closing brace
  assert.equal(r.method, 'balanced')
  assert.deepEqual(r.value, { command: 'ls -la', cwd: '/tmp' })
})

test('repair: single quotes + trailing comma via json5', () => {
  const r = repairToolArgs("{'name': 'edit_file', 'lines': [1,2,3,],}")
  assert.equal(r.value?.['name'], 'edit_file')
  assert.deepEqual(r.value?.['lines'], [1, 2, 3])
})

test('repair: unrecoverable garbage → null', () => {
  assert.equal(repairToolArgs('not json at all <<>>').value, null)
})

const schema: ToolParamSchema = {
  required: ['path', 'content'],
  properties: { path: { type: 'string' }, content: { type: 'string' }, overwrite: { type: 'boolean' } },
}

test('validate: complete + well-typed call passes', () => {
  const v = validateToolCall('write_file', { path: 'a.ts', content: 'x', overwrite: true }, schema)
  assert.equal(v.ok, true)
  assert.equal(v.repromptHint, null)
})

test('validate: missing required arg → reprompt hint', () => {
  const v = validateToolCall('write_file', { path: 'a.ts' }, schema)
  assert.equal(v.ok, false)
  assert.deepEqual(v.missing, ['content'])
  assert.match(v.repromptHint!, /missing required argument: content/)
})

test('validate: wrong primitive type is caught', () => {
  const v = validateToolCall('write_file', { path: 'a.ts', content: 'x', overwrite: 'yes' }, schema)
  assert.equal(v.ok, false)
  assert.ok(v.typeErrors.some((e) => e.includes('overwrite')))
})

test('validate: empty-string required counts as missing', () => {
  const v = validateToolCall('write_file', { path: '', content: 'x' }, schema)
  assert.deepEqual(v.missing, ['path'])
})
