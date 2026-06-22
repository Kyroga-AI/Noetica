import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  checkAction, resolvePurpose, PURPOSES, DEFAULT_PURPOSE, type ContainmentState,
  armKillSwitch, disarmKillSwitch, bindPurpose, assertCapability, permits, containmentState,
} from './agent-containment.js'

const stateWith = (purposeName: string, killed = false): ContainmentState => ({
  killed, reason: killed ? 'test' : null, since: null, purpose: resolvePurpose(purposeName),
})

test('purpose-binding: read-only permits read+model, denies write/exec/net', () => {
  const s = stateWith('read-only')
  assert.equal(checkAction(s, 'fs-read').allowed, true)
  assert.equal(checkAction(s, 'model').allowed, true)
  assert.equal(checkAction(s, 'fs-write').allowed, false)
  assert.equal(checkAction(s, 'exec').allowed, false)
  assert.equal(checkAction(s, 'net').allowed, false)
})

test('purpose-binding: research allows net + tool but NOT exec or fs-write', () => {
  const s = stateWith('research')
  assert.equal(checkAction(s, 'net').allowed, true)
  assert.equal(checkAction(s, 'tool').allowed, true)
  assert.equal(checkAction(s, 'exec').allowed, false)
  assert.equal(checkAction(s, 'fs-write').allowed, false)
})

test('purpose-binding: build allows exec+fs-write but NOT raw net egress', () => {
  const s = stateWith('build')
  assert.equal(checkAction(s, 'exec').allowed, true)
  assert.equal(checkAction(s, 'fs-write').allowed, true)
  assert.equal(checkAction(s, 'net').allowed, false)
})

test('kill-switch overrides everything, even under the full purpose', () => {
  const s = stateWith('full', true)
  for (const cap of ['net', 'fs-read', 'fs-write', 'exec', 'tool', 'model', 'memory-write'] as const) {
    const v = checkAction(s, cap)
    assert.equal(v.allowed, false)
    assert.match(v.reason, /kill-switch ARMED/)
  }
})

test('unknown purpose name falls back to full', () => {
  assert.equal(resolvePurpose('nonsense'), DEFAULT_PURPOSE)
  assert.equal(resolvePurpose(undefined), DEFAULT_PURPOSE)
  assert.equal(resolvePurpose('research'), PURPOSES['research'])
})

test('runtime guard: assertCapability throws when denied, passes when allowed', () => {
  bindPurpose('read-only')
  disarmKillSwitch()
  assert.equal(permits('fs-read'), true)
  assert.doesNotThrow(() => assertCapability('fs-read'))
  assert.throws(() => assertCapability('exec'), /CONTAINMENT BLOCKED/)
  // arm kill → even fs-read is blocked
  armKillSwitch('manual stop')
  assert.equal(permits('fs-read'), false)
  assert.throws(() => assertCapability('fs-read'), /kill-switch ARMED \(manual stop\)/)
  assert.equal(containmentState().killed, true)
  // restore for any later tests
  disarmKillSwitch(); bindPurpose('full')
})
