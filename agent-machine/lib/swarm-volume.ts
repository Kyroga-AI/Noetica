/**
 * swarm-volume.ts — a local TopoLVM-style volume the agent-machine provisions so a SWARM of agents shares one
 * mount and coordinates over it. TopoLVM is the k8s CSI driver that dynamically carves LVM logical volumes out
 * of a node's volume group; here we do the desktop analog: dynamically provision a per-swarm volume, prefer a
 * real LVM logical volume when lvm2 is present (Linux fleet nodes — the FUTURE PRIMARY target), and fall back
 * to a directory-backed volume everywhere else. The volume carries the swarm manifest (members + a shared
 * blackboard dir) so dispatched agents discover each other and share state — the substrate for swarming.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

export type VolumeBackend = 'lvm' | 'directory'
export interface SwarmVolume { swarmId: string; backend: VolumeBackend; path: string; sizeGiB: number; vg?: string; lv?: string; mounted: boolean }
export interface SwarmMember { agentId: string; role?: string; joinedAt: number; lastSeen: number }
export interface SwarmManifest { swarmId: string; createdAt: number; volume: SwarmVolume; members: SwarmMember[] }

const ROOT = () => join(homedir(), '.noetica', 'swarm-volumes')
const slug = (s: string) => (String(s).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'swarm')

/** Is LVM available (a node we could carve a real logical volume on)? Best-effort, never throws. */
export function lvmAvailable(): boolean {
  if (process.platform !== 'linux') return false
  try { execFileSync('/usr/bin/env', ['sh', '-c', 'command -v vgs && command -v lvcreate'], { stdio: 'ignore' }); return true }
  catch { return false }
}

/** Pick the first volume group with free space (TopoLVM's node-VG selection), or null. */
function firstVolumeGroup(): string | null {
  try {
    const out = execFileSync('vgs', ['--noheadings', '-o', 'vg_name', '--separator', ',', '--rows'], { encoding: 'utf8' }).trim()
    return out.split(/[,\n]/).map((s) => s.trim()).filter(Boolean)[0] ?? null
  } catch { return null }
}

/**
 * Provision (idempotently) the swarm's volume + manifest. Tries an LVM logical volume when available + opts.lvm,
 * else a directory-backed volume. Returns the mount path the swarm coordinates over. Never throws — a swarm
 * must always get *a* shared mount, even if it's just a directory.
 */
export function provisionSwarmVolume(opts: { swarmId: string; sizeGiB?: number; backend?: 'auto' | 'lvm' | 'directory' }): SwarmVolume {
  const swarmId = slug(opts.swarmId)
  const sizeGiB = Math.min(512, Math.max(1, opts.sizeGiB ?? 4))
  const base = join(ROOT(), swarmId)
  mkdirSync(base, { recursive: true })
  const mountPath = join(base, 'mnt')
  const wantLvm = (opts.backend ?? 'auto') !== 'directory' && (opts.backend === 'lvm' || lvmAvailable())

  if (wantLvm) {
    const vg = firstVolumeGroup()
    const lv = `noetica-${swarmId}`
    if (vg) {
      try {
        // Carve the LV (idempotent: ignore "already exists"), make an fs, mount it — the real TopoLVM path.
        try { execFileSync('lvcreate', ['-n', lv, '-L', `${sizeGiB}G`, vg], { stdio: 'ignore' }) } catch { /* may already exist */ }
        const dev = `/dev/${vg}/${lv}`
        try { execFileSync('mkfs.ext4', ['-F', dev], { stdio: 'ignore' }) } catch { /* already formatted */ }
        mkdirSync(mountPath, { recursive: true })
        try { execFileSync('mount', [dev, mountPath], { stdio: 'ignore' }) } catch { /* may already be mounted */ }
        const vol: SwarmVolume = { swarmId, backend: 'lvm', path: mountPath, sizeGiB, vg, lv, mounted: true }
        ensureManifest(vol); return vol
      } catch { /* fall through to directory */ }
    }
  }
  // Directory-backed volume (default everywhere; macOS + nodes without LVM).
  mkdirSync(mountPath, { recursive: true })
  const vol: SwarmVolume = { swarmId, backend: 'directory', path: mountPath, sizeGiB, mounted: true }
  ensureManifest(vol)
  return vol
}

const manifestPath = (swarmId: string) => join(ROOT(), slug(swarmId), 'swarm.json')

function ensureManifest(vol: SwarmVolume): SwarmManifest {
  const p = manifestPath(vol.swarmId)
  if (existsSync(p)) { try { return JSON.parse(readFileSync(p, 'utf8')) as SwarmManifest } catch { /* recreate */ } }
  const m: SwarmManifest = { swarmId: vol.swarmId, createdAt: Date.now(), volume: vol, members: [] }
  writeManifest(m)
  // The shared blackboard the swarm coordinates over (claims, task ledger, partials).
  mkdirSync(join(vol.path, 'blackboard'), { recursive: true })
  return m
}

function writeManifest(m: SwarmManifest): void {
  const p = manifestPath(m.swarmId)
  const tmp = `${p}.tmp.${process.pid}`
  writeFileSync(tmp, JSON.stringify(m, null, 2)); renameSync(tmp, p)
}

export function readManifest(swarmId: string): SwarmManifest | null {
  const p = manifestPath(swarmId)
  if (!existsSync(p)) return null
  try { return JSON.parse(readFileSync(p, 'utf8')) as SwarmManifest } catch { return null }
}

/** An agent joins the swarm (idempotent — updates lastSeen). Provisions the volume on first join. */
export function joinSwarm(swarmId: string, agentId: string, role?: string): SwarmManifest {
  let m = readManifest(swarmId)
  if (!m) { provisionSwarmVolume({ swarmId }); m = readManifest(swarmId)! }
  const now = Date.now()
  const existing = m.members.find((x) => x.agentId === agentId)
  if (existing) { existing.lastSeen = now; if (role) existing.role = role }
  else m.members.push({ agentId, role, joinedAt: now, lastSeen: now })
  writeManifest(m); return m
}

export function leaveSwarm(swarmId: string, agentId: string): SwarmManifest | null {
  const m = readManifest(swarmId); if (!m) return null
  m.members = m.members.filter((x) => x.agentId !== agentId)
  writeManifest(m); return m
}

/** Members seen within `withinMs` (default 5 min) — the live swarm. */
export function swarmMembers(swarmId: string, withinMs = 5 * 60_000, now = Date.now()): SwarmMember[] {
  return (readManifest(swarmId)?.members ?? []).filter((x) => now - x.lastSeen < withinMs)
}

/** Enumerate all local swarms with their members + live count — for the Fleet panel. */
export function listSwarms(withinMs = 5 * 60_000, now = Date.now()): Array<{ swarmId: string; createdAt: number; backend: VolumeBackend; mounted: boolean; members: SwarmMember[]; live: number }> {
  const root = ROOT()
  if (!existsSync(root)) return []
  let dirs: string[] = []
  try { dirs = readdirSync(root) } catch { return [] }
  const out: Array<{ swarmId: string; createdAt: number; backend: VolumeBackend; mounted: boolean; members: SwarmMember[]; live: number }> = []
  for (const d of dirs) {
    try {
      const p = join(root, d, 'swarm.json')
      if (!existsSync(p)) continue
      const m = JSON.parse(readFileSync(p, 'utf8')) as SwarmManifest
      const members = m.members ?? []
      out.push({ swarmId: m.swarmId, createdAt: m.createdAt, backend: m.volume?.backend ?? 'directory', mounted: m.volume?.mounted ?? false, members, live: members.filter((x) => now - x.lastSeen < withinMs).length })
    } catch { /* skip unreadable manifest */ }
  }
  return out.sort((a, b) => b.createdAt - a.createdAt)
}

const blackboardDir = (swarmId: string) => join(ROOT(), slug(swarmId), 'mnt', 'blackboard')

/** An agent posts a result/partial to the shared blackboard so co-agents + the parent can read it. */
export function writeBlackboard(swarmId: string, key: string, data: unknown): void {
  const dir = blackboardDir(swarmId); mkdirSync(dir, { recursive: true })
  const p = join(dir, `${slug(key)}.json`); const tmp = `${p}.tmp.${process.pid}`
  writeFileSync(tmp, JSON.stringify(data)); renameSync(tmp, p)
}

/** Read all blackboard entries for the swarm (the shared working set). */
export function readBlackboard(swarmId: string): Array<{ key: string; data: unknown }> {
  const dir = blackboardDir(swarmId); if (!existsSync(dir)) return []
  try {
    const { readdirSync } = require('node:fs') as typeof import('node:fs')
    return readdirSync(dir).filter((f) => f.endsWith('.json') && !f.includes('.tmp.')).map((f) => {
      try { return { key: f.replace(/\.json$/, ''), data: JSON.parse(readFileSync(join(dir, f), 'utf8')) } } catch { return null }
    }).filter((x): x is { key: string; data: unknown } => x !== null)
  } catch { return [] }
}
