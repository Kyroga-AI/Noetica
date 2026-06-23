/**
 * brain-provision — see what knowledge a machine has, and fetch the shippable brains onto a fresh one.
 *
 * A fresh install has empty academic/operations brains (that is why a friend's install couldn't answer
 * STEM/ops questions). This reports per-brain presence and installs a brain from a configured artifact
 * URL (a .tar.gz) into the canonical brain-home — mirroring how the runtime is provisioned to ~/.noetica
 * at first boot. The chat brain is personal and never provisioned. Hosting the artifacts is a deployment
 * step (set the URL envs); the mechanism here is ready regardless.
 */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { execFile } from 'node:child_process'
import { academicBrainDir, opsBrainFile, brainHome } from './brain-home.js'
import { BrainScope } from './brain-scope.js'

export interface BrainStatusEntry { name: string; scope: string; present: boolean; location: string; detail: string }

/** Lightweight presence report for the three brains (no expensive directory walks). */
export function brainStatus(): { brains: BrainStatusEntry[]; brainHome: string } {
  const out: BrainStatusEntry[] = []

  const acad = academicBrainDir()
  let acadFields = 0
  try {
    if (fs.existsSync(acad)) acadFields = fs.readdirSync(acad).filter((d) => { try { return fs.statSync(path.join(acad, d)).isDirectory() } catch { return false } }).length
  } catch { /* ignore */ }
  out.push({ name: 'academic', scope: BrainScope.Academic, present: acadFields > 0, location: acad, detail: acadFields ? `${acadFields} subject fields` : 'not provisioned' })

  const ops = opsBrainFile()
  let opsSize = 0
  try { opsSize = fs.existsSync(ops) ? fs.statSync(ops).size : 0 } catch { /* ignore */ }
  out.push({ name: 'operational', scope: BrainScope.Operational, present: opsSize > 0, location: ops, detail: opsSize ? `${(opsSize / 1e6).toFixed(1)} MB corpus` : 'not provisioned' })

  const chat = process.env['HELLGRAPH_STORE_DIR'] || path.join(os.homedir(), '.noetica', 'hellgraph')
  let chatPresent = false
  try { chatPresent = fs.existsSync(chat) && fs.readdirSync(chat).length > 0 } catch { /* ignore */ }
  out.push({ name: 'chat', scope: BrainScope.Chat, present: chatPresent, location: chat, detail: chatPresent ? 'present (personal, never shipped)' : 'empty' })

  return { brains: out, brainHome: brainHome() }
}

const URL_ENV: Record<string, string> = { academic: 'NOETICA_BRAIN_ACADEMIC_URL', operational: 'NOETICA_BRAIN_OPS_URL' }

export interface ProvisionProgress { phase: 'downloading' | 'extracting' | 'done'; pct: number | null }
export interface ProvisionResult { ok: boolean; message: string }

/** Download + install a shippable brain from its configured URL (a .tar.gz) into the brain-home. */
export async function provisionBrain(name: 'academic' | 'operational', onProgress?: (p: ProvisionProgress) => void): Promise<ProvisionResult> {
  const env = URL_ENV[name]
  const url = env ? process.env[env]?.trim() : ''
  if (!url) return { ok: false, message: `No download URL configured for the ${name} brain — set ${env} to a .tar.gz artifact URL.` }
  if (!/^https:\/\//.test(url)) return { ok: false, message: `${env} must be an https URL.` }

  const target = name === 'academic' ? academicBrainDir() : path.dirname(opsBrainFile())
  const tmp = path.join(os.tmpdir(), `noetica-brain-${name}-${Date.now()}.tar.gz`)
  try {
    onProgress?.({ phase: 'downloading', pct: 0 })
    const res = await fetch(url, { signal: AbortSignal.timeout(30 * 60_000) })
    if (!res.ok || !res.body) return { ok: false, message: `download failed: HTTP ${res.status}` }
    const total = Number(res.headers.get('content-length') || 0)
    let seen = 0
    const ws = fs.createWriteStream(tmp)
    const reader = res.body.getReader()
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        ws.write(Buffer.from(value))
        seen += value.length
        if (total) onProgress?.({ phase: 'downloading', pct: Math.round((seen / total) * 100) })
      }
    } finally { reader.releaseLock(); ws.end() }
    await new Promise<void>((resolve, reject) => { ws.on('finish', () => resolve()); ws.on('error', reject) })

    onProgress?.({ phase: 'extracting', pct: null })
    fs.mkdirSync(target, { recursive: true })
    await new Promise<void>((resolve, reject) => {
      execFile('tar', ['-xzf', tmp, '-C', target], { timeout: 20 * 60_000 }, (err) => (err ? reject(err) : resolve()))
    })
    onProgress?.({ phase: 'done', pct: 100 })
    return { ok: true, message: `${name} brain installed to ${target}` }
  } catch (e) {
    return { ok: false, message: `provisioning failed: ${e instanceof Error ? e.message : String(e)}` }
  } finally {
    try { fs.unlinkSync(tmp) } catch { /* ignore */ }
  }
}
