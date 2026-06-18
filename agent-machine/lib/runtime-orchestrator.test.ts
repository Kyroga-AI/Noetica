import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planBootstrap } from './runtime-orchestrator.js'
import type { HostProfile } from './host-profile.js'

const mac = (ramGb: number, krunkit = false): HostProfile => ({
  os: 'darwin', arch: 'arm64', totalRamGb: ramGb, cpus: 8,
  gpu: { metal: true, nvidia: false }, virtualization: { podman: true, krunkit },
})

test('low-RAM Mac → provision native runtime, no machine, pull RAM-appropriate models', () => {
  const p = planBootstrap(mac(8, true), [])  // nothing installed
  assert.equal(p.selection.provider, 'seatbelt-native-metal')
  assert.equal(p.provisionRuntime, true)
  assert.equal(p.provisionMachine, false)
  assert.deepEqual(p.modelsToPull, ['llama3.2:3b', 'nomic-embed-text']) // 3b ceiling
})

test('already-installed models are not re-pulled', () => {
  const p = planBootstrap(mac(8, true), ['llama3.2:3b', 'nomic-embed-text:latest'])
  assert.deepEqual(p.modelsToPull, [])
  assert.match(p.steps.join(' '), /already present/)
})

test('high-RAM Mac + krunkit → provision a machine (VM), not a native runtime', () => {
  const p = planBootstrap(mac(32, true), [])
  assert.equal(p.selection.tier, 'vm')
  assert.equal(p.provisionMachine, true)
  assert.equal(p.provisionRuntime, false)
})

test('Linux + NVIDIA → container machine plan', () => {
  const p = planBootstrap({ os: 'linux', arch: 'x64', totalRamGb: 64, cpus: 16, gpu: { metal: false, nvidia: true }, virtualization: { podman: true, krunkit: false } }, [])
  assert.equal(p.provisionMachine, true)
  assert.equal(p.provisionRuntime, false)
  assert.match(p.steps.join(' '), /model plane/)
})
