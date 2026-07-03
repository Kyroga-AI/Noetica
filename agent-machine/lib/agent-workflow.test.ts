import { test } from 'node:test'
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { AgentMemory } from './agent-memory.js'
import { AgentWorkflow } from './agent-workflow.js'

// fresh, isolated memory dir per test (each workflow starts with an empty living-KB)
async function wf() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'noetica-wf-'))
  process.env.NOETICA_MEMORY_DIR = dir
  return new AgentWorkflow(new AgentMemory({ identity: { user_id: 'm', agent_id: 'noetica', run_id: 'r1' } }), 'workspace')
}

test('PM plan() writes the base artifacts to the living-KB', async () => {
  const w = await wf()
  const arts = await w.plan(['build the cockpit', 'wire the skin'])
  assert.deepEqual(arts, ['REQUIREMENTS', 'AGENT_TASKS'])
})

test('handoff to designer is admitted once REQUIREMENTS exists', async () => {
  const w = await wf()
  assert.equal((await w.handoff('designer')).admitted, false)   // nothing produced yet
  await w.plan(['x'])
  assert.equal((await w.handoff('designer')).admitted, true)
})

test('frontend handoff is BLOCKED until DESIGN exists (artifacts-before-handoff gate)', async () => {
  const w = await wf()
  await w.plan(['x'])
  const blocked = await w.handoff('frontend')
  assert.equal(blocked.admitted, false)
  assert.deepEqual(blocked.missing, ['DESIGN'])
  await w.produce('DESIGN', '# Design\nthe UI spec')            // designer produces it
  assert.equal((await w.handoff('frontend')).admitted, true)
})

test('tester handoff is BLOCKED until TEST_PLAN exists', async () => {
  const w = await wf()
  await w.plan(['x'])
  assert.deepEqual((await w.handoff('tester')).missing, ['TEST_PLAN'])
  await w.produce('TEST_PLAN', '# Test plan\n- acceptance: cockpit renders')
  assert.equal((await w.handoff('tester')).admitted, true)
})
