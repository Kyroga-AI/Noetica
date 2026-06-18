import { test } from 'node:test'
import assert from 'node:assert/strict'
import { selectIsolationTier, type HostProfile } from './host-profile.js'

const mac = (ramGb: number, krunkit = false): HostProfile => ({
  os: 'darwin', arch: 'arm64', totalRamGb: ramGb, cpus: 8,
  gpu: { metal: true, nvidia: false }, virtualization: { podman: true, krunkit },
})

test('macOS low-RAM box → fast sandboxed-native Metal, NOT a slow CPU-in-VM', () => {
  const s = selectIsolationTier(mac(8, true)) // krunkit present but RAM too low for a VM
  assert.equal(s.provider, 'seatbelt-native-metal')
  assert.equal(s.gpu, 'metal')
  assert.equal(s.modelCeiling, 'small-3b')
})

test('macOS high-RAM + krunkit → full VM isolation with venus-Vulkan GPU (opinionated upgrade)', () => {
  const s = selectIsolationTier(mac(32, true))
  assert.equal(s.tier, 'vm')
  assert.equal(s.provider, 'podman-vm-krunkit')
  assert.equal(s.gpu, 'vulkan-venus')
  assert.equal(s.modelCeiling, 'large-8b-plus')
})

test('macOS high-RAM WITHOUT krunkit → still native Metal (never a slow CPU-VM by default)', () => {
  const s = selectIsolationTier(mac(32, false))
  assert.equal(s.provider, 'seatbelt-native-metal')
  assert.match(s.rationale, /krunkit/)
})

test('Linux + NVIDIA → rootless container with GPU; no NVIDIA → container CPU', () => {
  const gpu = selectIsolationTier({ os: 'linux', arch: 'x64', totalRamGb: 64, cpus: 16, gpu: { metal: false, nvidia: true }, virtualization: { podman: true, krunkit: false } })
  assert.equal(gpu.provider, 'podman-container-nvidia')
  assert.equal(gpu.tier, 'container')
  const cpu = selectIsolationTier({ os: 'linux', arch: 'arm64', totalRamGb: 16, cpus: 8, gpu: { metal: false, nvidia: false }, virtualization: { podman: true, krunkit: false } })
  assert.equal(cpu.provider, 'podman-container-cpu')
})

test('stronger hardware ⇒ stronger isolation by default (the core opinion)', () => {
  assert.equal(selectIsolationTier(mac(8, true)).tier, 'container')  // weak box: sandboxed native
  assert.equal(selectIsolationTier(mac(32, true)).tier, 'vm')        // strong box: full VM
})
