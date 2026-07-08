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
import { promisify } from 'node:util'
import * as crypto from 'node:crypto'

const execFileP = promisify(execFile)
import { academicBrainDir, opsBrainFile, brainHome } from './brain-home.js'
import { BrainScope } from './brain-scope.js'
import { fetchBrainManifest, entryFor, type BrainManifest } from './brain-manifest.js'

export interface BrainStatusEntry {
  name: string; scope: string; present: boolean; location: string; detail: string
  installedVersion?: string | null; availableVersion?: string | null; updateAvailable?: boolean
}

// The version marker the provisioner writes after a successful install, so updates can be detected.
function versionMarkerPath(name: 'academic' | 'operational'): string {
  const target = name === 'academic' ? academicBrainDir() : path.dirname(opsBrainFile())
  return path.join(target, '.brain-version')
}
export function installedBrainVersion(name: 'academic' | 'operational'): string | null {
  try { return fs.readFileSync(versionMarkerPath(name), 'utf8').trim() || null } catch { return null }
}

// Streaming sha256 — the academic artifact is GBs, never read it whole into memory.
function sha256File(p: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256')
    const s = fs.createReadStream(p)
    s.on('data', (d) => h.update(d as Buffer))
    s.on('end', () => resolve(h.digest('hex')))
    s.on('error', reject)
  })
}

function withVersions(name: 'academic' | 'operational', e: BrainStatusEntry, manifest?: BrainManifest | null): BrainStatusEntry {
  const installedVersion = installedBrainVersion(name)
  const availableVersion = manifest?.brains?.[name]?.version ?? null
  // Only a genuine update: present, both versions known, and they differ. A present brain with no marker
  // (a pre-versioning install) is left alone, not nagged.
  const updateAvailable = e.present && installedVersion != null && availableVersion != null && installedVersion !== availableVersion
  return { ...e, installedVersion, availableVersion, updateAvailable }
}

/** Presence + version report for the three brains. Pass the manifest to include available/update info. */
export function brainStatus(manifest?: BrainManifest | null): { brains: BrainStatusEntry[]; brainHome: string } {
  const out: BrainStatusEntry[] = []

  const acad = academicBrainDir()
  let acadFields = 0
  try {
    if (fs.existsSync(acad)) acadFields = fs.readdirSync(acad).filter((d) => { try { return fs.statSync(path.join(acad, d)).isDirectory() } catch { return false } }).length
  } catch { /* ignore */ }
  out.push(withVersions('academic', { name: 'academic', scope: BrainScope.Academic, present: acadFields > 0, location: acad, detail: acadFields ? `${acadFields} subject fields` : 'not provisioned' }, manifest))

  const ops = opsBrainFile()
  let opsSize = 0
  try { opsSize = fs.existsSync(ops) ? fs.statSync(ops).size : 0 } catch { /* ignore */ }
  out.push(withVersions('operational', { name: 'operational', scope: BrainScope.Operational, present: opsSize > 0, location: ops, detail: opsSize ? `${(opsSize / 1e6).toFixed(1)} MB corpus` : 'not provisioned' }, manifest))

  const chat = process.env['HELLGRAPH_STORE_DIR'] || path.join(os.homedir(), '.noetica', 'hellgraph')
  let chatPresent = false
  try { chatPresent = fs.existsSync(chat) && fs.readdirSync(chat).length > 0 } catch { /* ignore */ }
  out.push({ name: 'chat', scope: BrainScope.Chat, present: chatPresent, location: chat, detail: chatPresent ? 'present (personal, never shipped)' : 'empty' })

  return { brains: out, brainHome: brainHome() }
}

const URL_ENV: Record<string, string> = { academic: 'NOETICA_BRAIN_ACADEMIC_URL', operational: 'NOETICA_BRAIN_OPS_URL' }

/**
 * The download URL for a brain: an explicit env override, else the official release asset (the GitHub
 * "latest" alias). So a brew-installed app loads its knowledge from the release WITHOUT any configuration
 * — and the URL keeps working across versions. Override the base with NOETICA_RELEASE_BASE_URL.
 */
export function brainUrl(name: 'academic' | 'operational'): string {
  const env = process.env[URL_ENV[name]!]?.trim()
  if (env) return env
  const base = (process.env['NOETICA_RELEASE_BASE_URL'] || 'https://github.com/SocioProphet/Noetica/releases/latest/download').replace(/\/$/, '')
  return `${base}/${name}-brain.tar.gz`
}

export interface ProvisionProgress { phase: 'downloading' | 'extracting' | 'done'; pct: number | null }
export interface ProvisionResult { ok: boolean; message: string }

/**
 * Reject an archive whose members could write outside the extraction root — absolute paths, `..`
 * traversal, or symlink/hardlink members whose target escapes. Belt-and-braces on top of the
 * staging-dir confinement below; do NOT rely on the tar CLI's own defaults across platforms.
 */
async function assertSafeTarMembers(archive: string): Promise<void> {
  // -tv lists type + (for links) "name -> target"; parse both.
  const { stdout } = await execFileP('tar', ['-tvzf', archive], { maxBuffer: 64 * 1024 * 1024 })
  const bad = (p: string): boolean =>
    !p ||
    p.startsWith('/') ||
    /^[a-zA-Z]:[\\/]/.test(p) ||               // windows drive-absolute
    p.split(/[\\/]/).some((seg) => seg === '..')
  for (const line of stdout.split('\n')) {
    if (!line.trim()) continue
    const type = line[0]                       // '-' file, 'd' dir, 'l' symlink, 'h' hardlink
    // strip the mode/owner/size/date columns; the name (and link arrow) is the tail after the time field.
    const m = line.match(/\d{2}:\d{2}\s+(.*)$/) || line.match(/\d{4}\s+(.*)$/)
    const tail = (m ? m[1] : line).trim()
    const [name, linkTarget] = tail.split(' -> ')
    if (bad(name!)) throw new Error(`unsafe archive member: ${name}`)
    if ((type === 'l' || type === 'h') && linkTarget && bad(linkTarget)) {
      throw new Error(`unsafe link member: ${name} -> ${linkTarget}`)
    }
  }
}

/** Resolve where a brain comes from: env override > the service manifest (versioned + checksummed) >
 *  the static release URL. */
async function resolveSource(name: 'academic' | 'operational'): Promise<{ url: string; sha256: string; version: string }> {
  const env = process.env[URL_ENV[name]!]?.trim()
  if (env) return { url: env, sha256: '', version: '' }
  const e = entryFor(await fetchBrainManifest(), name)
  if (e) return { url: e.url, sha256: e.sha256 || '', version: e.version || '' }
  return { url: brainUrl(name), sha256: '', version: '' } // static release fallback
}

/** Walk a tree and return every symlink path (used to reject post-extraction symlink escapes). */
function collectSymlinks(root: string): string[] {
  const out: string[] = []
  const walk = (dir: string): void => {
    let entries: fs.Dirent[]
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      const p = path.join(dir, e.name)
      if (e.isSymbolicLink()) out.push(p)
      else if (e.isDirectory()) walk(p)
    }
  }
  walk(root)
  return out
}

/** Download + install a shippable brain (a .tar.gz) into the brain-home, via the manifest service. */
export async function provisionBrain(name: 'academic' | 'operational', onProgress?: (p: ProvisionProgress) => void): Promise<ProvisionResult> {
  const { url, sha256: expectedSha, version } = await resolveSource(name)
  if (!/^https:\/\//.test(url)) return { ok: false, message: `brain URL must be https (got ${url}).` }

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

    // Integrity: never install a corrupt/tampered/unverified brain. A trusted sha256 is REQUIRED —
    // the corpus is untarred and fed to the model/RAG, so an unverified download is a data-poisoning
    // and (via a malicious tar) filesystem-write vector. Fail closed unless explicitly overridden for dev.
    const allowUnverified = process.env['NOETICA_BRAIN_ALLOW_UNVERIFIED'] === '1'
    if (!expectedSha) {
      if (!allowUnverified) {
        return { ok: false, message: `refusing to install the ${name} brain: no trusted sha256 available (the manifest did not publish a checksum). Set NOETICA_BRAIN_ALLOW_UNVERIFIED=1 to override for local development.` }
      }
      console.warn(`[brain-provision] WARNING: installing ${name} brain WITHOUT integrity verification (NOETICA_BRAIN_ALLOW_UNVERIFIED=1).`)
    } else {
      const got = await sha256File(tmp)
      if (got !== expectedSha) return { ok: false, message: `integrity check FAILED for the ${name} brain (sha256 mismatch) — refusing to install` }
    }

    onProgress?.({ phase: 'extracting', pct: null })
    // Refuse traversal/symlink-escape members, then extract into a fresh staging dir (blast-radius
    // confinement) with ownership/perms not honored, and only then move the vetted tree into place.
    await assertSafeTarMembers(tmp)
    fs.mkdirSync(target, { recursive: true })
    const staging = fs.mkdtempSync(path.join(os.tmpdir(), `noetica-brain-stage-${name}-`))
    try {
      await new Promise<void>((resolve, reject) => {
        execFile('tar', ['-xzf', tmp, '-C', staging, '--no-same-owner', '--no-same-permissions'], { timeout: 20 * 60_000 }, (err) => (err ? reject(err) : resolve()))
      })
      // Defense-in-depth: reject if extraction produced any symlink escaping the staging root.
      for (const link of collectSymlinks(staging)) {
        const resolved = fs.realpathSync(path.dirname(link)) + path.sep + path.basename(link)
        const dest = path.resolve(path.dirname(link), fs.readlinkSync(link))
        if (!dest.startsWith(fs.realpathSync(staging) + path.sep)) throw new Error(`extracted symlink escapes staging: ${resolved} -> ${dest}`)
      }
      fs.cpSync(staging, target, { recursive: true, force: true })
    } finally {
      try { fs.rmSync(staging, { recursive: true, force: true }) } catch { /* ignore */ }
    }
    // Record the installed version so the next manifest check can detect an update.
    if (version) { try { fs.writeFileSync(versionMarkerPath(name), version) } catch { /* best-effort */ } }
    onProgress?.({ phase: 'done', pct: 100 })
    return { ok: true, message: `${name} brain ${version ? `v${version} ` : ''}installed to ${target}` }
  } catch (e) {
    return { ok: false, message: `provisioning failed: ${e instanceof Error ? e.message : String(e)}` }
  } finally {
    try { fs.unlinkSync(tmp) } catch { /* ignore */ }
  }
}
