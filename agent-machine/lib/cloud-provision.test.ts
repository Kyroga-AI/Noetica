/** Tests for the broker provisioning adapter (plan + lifecycle, no real cloud calls). */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildCloudInit, createCommand, teardownCommand, provisionInstance, registerExecutor } from './cloud-provision.js'
import type { ComputeSku } from './cloud-broker.js'

const SKU: ComputeSku = { provider: 'azure', name: 'NC24ads_A100_v4', region: 'eastus', vcpus: 24, memGiB: 220, gpu: { type: 'A100-80GB', count: 1, memGiB: 80 }, usdPerHour: 3.67 }

test('buildCloudInit joins the swarm + registers to the control plane', () => {
  const ci = buildCloudInit({ swarmId: 'demo', controlPlane: 'http://cp:8080' })
  assert.ok(ci.includes('NOETICA_SWARM_ID="demo"'))
  assert.ok(ci.includes('/api/cap/swarm-volume'))
  assert.ok(ci.includes('ollama.com/install.sh'))
})

test('createCommand / teardownCommand are provider-native', () => {
  assert.ok(createCommand('gcp', 'a2-ultragpu-1g', 'us-central1', 'n1').startsWith('gcloud compute instances create'))
  assert.ok(createCommand('azure', 'NC24ads_A100_v4', 'eastus', 'n1').startsWith('az vm create'))
  assert.ok(createCommand('aws', 'p4de', 'us-east-1', 'n1').startsWith('aws ec2 run-instances'))
  assert.ok(teardownCommand('gcp', 'n1', 'us-central1').includes('delete'))
})

test('provisionInstance returns a complete lifecycle record + registers an agentplane executor', () => {
  const rec = provisionInstance(SKU, { swarmId: 'demo', controlPlane: 'http://cp:8080', usdPerHour: 1.47 })
  assert.equal(rec.provider, 'azure')
  assert.equal(rec.state, 'planned')
  assert.equal(rec.usdPerHour, 1.47)
  assert.ok(rec.cloudInit.includes('demo'))
  assert.ok(rec.createCommand.startsWith('az vm create'))
  assert.ok(rec.teardownCommand.includes('vm delete'))
  assert.equal(rec.executor.caps.gpu, 'A100-80GB')
  assert.equal(rec.executor.caps.kvm, true)
  // registerExecutor is idempotent (no throw on re-register)
  registerExecutor(rec)
})

test('executeProvision is a safe no-op without the exec gate', async () => {
  const { executeProvision } = await import('./cloud-provision.js')
  delete process.env['NOETICA_CLOUD_PROVISION_EXEC']
  const rec = provisionInstance(SKU, { swarmId: 'demo' })
  const r = await executeProvision(rec)
  assert.match(r.error ?? '', /gated/)   // gated → did not attempt a real boot
})
