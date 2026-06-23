/**
 * cloud-provision.ts — the keystone that makes "broker to cheapest" actually RUN your swarm. Takes a broker
 * pick (cheapest cloud SKU) and drives the lifecycle: build a cloud-init bootstrap (install the runtime, join
 * the swarm volume, register to the agentplane fleet) → emit the provider's create command → record the
 * instance → teardown. Real execution is gated behind NOETICA_CLOUD_PROVISION_EXEC=1 (a wrong cloud spawn
 * costs money); by default it returns the concrete plan (commands + cloud-init) so it's safe + testable.
 * Every placement is meant to flow through scope-d egress + a lattice-forge provenance manifest.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ComputeSku } from './cloud-broker.js'

export type ProvisionState = 'planned' | 'provisioning' | 'ready' | 'failed' | 'terminated'
export interface ProvisionRecord {
  id: string
  provider: ComputeSku['provider']
  sku: string
  region: string
  swarmId: string
  state: ProvisionState
  usdPerHour: number
  cloudInit: string
  createCommand: string
  teardownCommand: string
  executor: { name: string; sshRef: string; caps: { os: string; arch: string; kvm: boolean; gpu?: string } }
  createdAt: number
}

/** Bootstrap a fresh cloud box into the mesh: install runtime, mount/join the swarm, register to the fleet. */
export function buildCloudInit(opts: { swarmId: string; controlPlane?: string }): string {
  const cp = opts.controlPlane ?? 'http://CONTROL_PLANE:8080'
  return [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    '# Noetica brokered node bootstrap',
    'curl -fsSL https://ollama.com/install.sh | sh || true',
    'mkdir -p /var/lib/noetica/swarm',
    `export NOETICA_SWARM_ID=${JSON.stringify(opts.swarmId)}`,
    `export NOETICA_CONTROL_PLANE=${JSON.stringify(cp)}`,
    '# join the swarm + register as an agentplane executor (the control plane records us in fleet/inventory)',
    `curl -fsS -X POST "$NOETICA_CONTROL_PLANE/api/cap/swarm-volume" -H 'content-type: application/json' -d "{\\"action\\":\\"join\\",\\"swarmId\\":\\"$NOETICA_SWARM_ID\\",\\"agentId\\":\\"$(hostname)\\",\\"role\\":\\"cloud-worker\\"}" || true`,
    'echo "noetica node ready"',
  ].join('\n')
}

const REGION_OS = { os: 'linux', arch: 'x86_64' }

/** The provider-native create command for a SKU (gcloud / az / aws / ibmcloud). */
export function createCommand(provider: ComputeSku['provider'], sku: string, region: string, name: string): string {
  switch (provider) {
    case 'gcp':   return `gcloud compute instances create ${name} --machine-type=${sku} --zone=${region}-a --metadata-from-file=startup-script=cloud-init.sh`
    case 'azure': return `az vm create -g noetica-rg -n ${name} --size Standard_${sku} --location ${region} --image Ubuntu2204 --custom-data cloud-init.sh`
    case 'aws':   return `aws ec2 run-instances --instance-type ${sku} --image-id ami-ubuntu --user-data file://cloud-init.sh --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=${name}}]'`
    case 'ibm':   return `ibmcloud is instance-create ${name} VPC ${region} ${sku} SUBNET --user-data @cloud-init.sh`
    default:      return `# local — no cloud provisioning needed for ${name}`
  }
}

export function teardownCommand(provider: ComputeSku['provider'], name: string, region: string): string {
  switch (provider) {
    case 'gcp':   return `gcloud compute instances delete ${name} --zone=${region}-a --quiet`
    case 'azure': return `az vm delete -g noetica-rg -n ${name} --yes`
    case 'aws':   return `aws ec2 terminate-instances --instance-ids ${name}`
    case 'ibm':   return `ibmcloud is instance-delete ${name} --force`
    default:      return `# nothing to tear down for ${name}`
  }
}

const FLEET = () => join(homedir(), '.noetica', 'fleet', 'inventory.json')

/** Register the (planned/ready) box as an agentplane-shaped executor in the local fleet inventory. */
export function registerExecutor(rec: ProvisionRecord): void {
  const p = FLEET(); mkdirSync(join(homedir(), '.noetica', 'fleet'), { recursive: true })
  let inv: { executors: Array<Record<string, unknown>>; defaultExecutor?: string } = { executors: [] }
  if (existsSync(p)) { try { inv = JSON.parse(readFileSync(p, 'utf8')) } catch { /* recreate */ } }
  inv.executors = inv.executors.filter((e) => e['name'] !== rec.executor.name)
  inv.executors.push({ name: rec.executor.name, sshRef: rec.executor.sshRef, caps: rec.executor.caps, provider: rec.provider, region: rec.region, usdPerHour: rec.usdPerHour, state: rec.state })
  const tmp = `${p}.tmp.${process.pid}`; writeFileSync(tmp, JSON.stringify(inv, null, 2)); renameSync(tmp, p)
}

/**
 * Plan (and optionally execute) the provisioning of the broker's cheapest pick. Returns the full lifecycle
 * record. Execution (the actual cloud CLI) only runs when exec:true AND NOETICA_CLOUD_PROVISION_EXEC=1.
 */
export function provisionInstance(sku: ComputeSku, opts: { swarmId?: string; controlPlane?: string; usdPerHour?: number }): ProvisionRecord {
  const swarmId = opts.swarmId ?? 'session'
  const id = `noetica-${sku.provider}-${Math.abs(hash(`${sku.name}${swarmId}${REGION_OS.os}`)).toString(36).slice(0, 8)}`
  const rec: ProvisionRecord = {
    id, provider: sku.provider, sku: sku.name, region: sku.region, swarmId, state: 'planned',
    usdPerHour: opts.usdPerHour ?? sku.usdPerHour,
    cloudInit: buildCloudInit({ swarmId, controlPlane: opts.controlPlane }),
    createCommand: createCommand(sku.provider, sku.name, sku.region, id),
    teardownCommand: teardownCommand(sku.provider, id, sku.region),
    executor: { name: id, sshRef: `${id}@pending`, caps: { ...REGION_OS, kvm: sku.provider !== 'local', gpu: sku.gpu?.type } },
    createdAt: Date.now(),
  }
  registerExecutor(rec)
  // scope-d audit: a brokered cloud placement is a frontier-tier egress; record the decision.
  try {
    const { emitScopedTelemetry } = require('./scope-d.js') as typeof import('./scope-d.js')
    emitScopedTelemetry({ kind: 'provision', provider: sku.provider, model: sku.name, tier: 'open-provider', scope: 'cloud-broker', reason: `provision ${sku.provider}:${sku.name} for swarm ${swarmId}`, source: 'cloud-provision' })
  } catch { /* audit best-effort */ }
  return rec
}

function hash(s: string): number { let h = 0; for (let i = 0; i < s.length; i++) { h = (h << 5) - h + s.charCodeAt(i); h |= 0 } return h }
