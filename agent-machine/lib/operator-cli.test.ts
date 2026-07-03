import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateInvocation, operatorStatus } from './operator-cli.js'

test('allows an allow-listed tool + subcommand', () => {
  assert.deepEqual(validateInvocation('prophet', ['infra', 'status']), { ok: true })
  assert.deepEqual(validateInvocation('sourceosctl', ['doctor']), { ok: true })
})

test('rejects an unknown tool', () => {
  const r = validateInvocation('rm', ['-rf', '/'])
  assert.equal(r.ok, false)
})

test('rejects a non-allow-listed subcommand', () => {
  const r = validateInvocation('prophet', ['exec', 'sh'])
  assert.equal(r.ok, false)
})

test('rejects shell-metacharacter injection in args (no shell is used anyway)', () => {
  for (const bad of [['infra', '; rm -rf /'], ['infra', '$(whoami)'], ['infra', 'a|b'], ['infra', '`id`']]) {
    assert.equal(validateInvocation('prophet', bad).ok, false, `should reject ${JSON.stringify(bad)}`)
  }
})

test('operatorStatus reports both tools with an installed flag', async () => {
  const s = await operatorStatus()
  assert.ok('prophet' in s.tools && 'sourceosctl' in s.tools)
  assert.equal(typeof s.tools.prophet.installed, 'boolean')
  assert.ok(Array.isArray(s.tools.sourceosctl.subcommands))
})
