import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { saveCustomAgent, getCustomAgent, listCustomAgents, deleteCustomAgent } from './agent-registry.js'

// Isolate the store under a temp HOME so the test never touches the real ~/.noetica.
const realHome = os.homedir()
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'noetica-agents-'))
process.env['HOME'] = tmpHome

test('save → get → list → delete round-trip, with validation/clamping', () => {
  const saved = saveCustomAgent({ label: 'My Researcher!!', description: 'finds things', systemPrompt: 'You research.', tools: ['web_search', 'web_search', 'read_file'], maxTurns: 99, model: 'coder' })
  assert.equal(saved.id, 'my-researcher', 'label is slugged into an id')
  assert.equal(saved.maxTurns, 12, 'maxTurns clamped to 12')
  assert.deepEqual(saved.tools, ['web_search', 'read_file'], 'tools de-duped')
  assert.equal(saved.model, 'coder')
  assert.equal(saved.custom, true)

  const got = getCustomAgent('My Researcher!!')   // resolves by slug of any label form
  assert.equal(got?.id, 'my-researcher')
  assert.equal(got?.systemPrompt, 'You research.')

  assert.equal(listCustomAgents().length, 1)
  // Upsert (same id) replaces, not duplicates.
  saveCustomAgent({ id: 'my-researcher', label: 'My Researcher', systemPrompt: 'v2' })
  assert.equal(listCustomAgents().length, 1)
  assert.equal(getCustomAgent('my-researcher')?.systemPrompt, 'v2')

  assert.equal(deleteCustomAgent('my-researcher'), true)
  assert.equal(getCustomAgent('my-researcher'), null)
  assert.equal(deleteCustomAgent('my-researcher'), false, 'deleting a missing agent returns false')
})

test('a custom agent is shape-compatible with AgentRole (dispatchable)', () => {
  const a = saveCustomAgent({ label: 'Auditor', tools: ['read_file'], maxTurns: 3 })
  // The dispatch path reads .label/.systemPrompt/.tools/.maxTurns/.model — all present.
  for (const k of ['id', 'label', 'systemPrompt', 'tools', 'maxTurns'] as const) assert.ok(k in a, `has ${k}`)
})

process.on('exit', () => { process.env['HOME'] = realHome; try { fs.rmSync(tmpHome, { recursive: true, force: true }) } catch { /* */ } })
