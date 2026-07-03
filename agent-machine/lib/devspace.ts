/**
 * devspace.ts — the Nocalhost DevSpace model, mapped onto our isolation namespaces (the WHERE).
 *
 * Nocalhost: a DevSpace = Application (manifests) + KubeConfig = an ISOLATED per-user namespace, and a
 * BaseSpace (full isolated service set) vs MeshSpace (shares the baseline, routed by header). We map our
 * three trust namespaces straight onto that: self = an isolated BaseSpace (on-device, no egress),
 * workspace/collective = MeshSpaces that share a baseline (header/trust-routed). So the isolation model
 * IS the DevSpace model — same concept, one implementation. Surfaced as Workstation → Services.
 */
import { spawn } from 'node:child_process'
import type { TrustNamespace } from './isolation-policy.js'

export type SpaceType = 'base' | 'mesh' // Nocalhost BaseSpace vs MeshSpace
export type DevSpaceStatus = 'active' | 'not_deployed' | 'unknown'

export interface DevSpace {
  name: string
  trustNamespace: TrustNamespace
  kubeNamespace: string
  spaceType: SpaceType
  status: DevSpaceStatus
  application: string
  /** dev-mode fast-loop capabilities available for this space (Nocalhost: sync/port-forward/debug/exec). */
  devMode: Array<'file-sync' | 'port-forward' | 'debug' | 'exec'>
}

export const TRUST_NAMESPACES: TrustNamespace[] = ['self', 'workspace', 'collective']

/** Map a trust namespace to its DevSpace (isolation ↔ DevSpace). self → isolated BaseSpace; others → MeshSpace. */
export function devSpaceFor(ns: TrustNamespace, application = 'app'): DevSpace {
  return {
    name: `${application}@${ns}`,
    trustNamespace: ns,
    kubeNamespace: `noetica-${ns}`,
    spaceType: ns === 'self' ? 'base' : 'mesh',
    status: 'unknown',
    application,
    devMode: ['file-sync', 'port-forward', 'debug', 'exec'],
  }
}

function which(bin: string): Promise<boolean> {
  return new Promise((r) => { const c = spawn('sh', ['-c', `command -v ${bin}`]); c.on('close', (code) => r(code === 0)); c.on('error', () => r(false)) })
}
function capture(cmd: string, args: string[]): Promise<{ code: number; stdout: string }> {
  return new Promise((r) => { const c = spawn(cmd, args); let s = ''; c.stdout.on('data', (d: Buffer) => { s += d.toString() }); c.on('error', () => r({ code: -1, stdout: s })); c.on('close', (code) => r({ code: code ?? -1, stdout: s })) })
}

export interface DevSpaceListing { hasCluster: boolean; nhctl: boolean; spaces: DevSpace[]; note?: string }

/** The three trust-namespace DevSpaces + their live status (active if the k8s namespace exists). */
export async function listDevSpaces(application = 'app'): Promise<DevSpaceListing> {
  const spaces = TRUST_NAMESPACES.map((ns) => devSpaceFor(ns, application))
  const [kubectl, nhctl] = await Promise.all([which('kubectl'), which('nhctl')])
  if (!kubectl) return { hasCluster: false, nhctl, spaces, note: 'kubectl not installed — DevSpace mapping shown, status unknown' }
  const out = await capture('kubectl', ['get', 'ns', '-o', 'name'])
  if (out.code !== 0) return { hasCluster: false, nhctl, spaces, note: 'no reachable cluster/context' }
  const existing = new Set(out.stdout.split('\n').map((l) => l.replace('namespace/', '').trim()).filter(Boolean))
  for (const s of spaces) s.status = existing.has(s.kubeNamespace) ? 'active' : 'not_deployed'
  return { hasCluster: true, nhctl, spaces }
}
