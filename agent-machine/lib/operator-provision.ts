/**
 * operator-provision — fetch a trained neural-operator model (.onnx) onto a machine.
 *
 * The noetica-operator sidecar serves whatever `.onnx` files live in the operator dir; this is how they get
 * there on a real install — downloaded from a configured URL (env override > optional manifest > the release
 * asset), verified, and atomically installed. Mirrors brain-provision: https-only (loopback allowed so it's
 * testable), sha256 integrity check, temp-then-rename so a partial download never half-installs. The serving
 * binary ships in the app bundle; the MODELS come through here (they're large + versioned independently).
 */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import * as crypto from 'node:crypto'

/** Where the sidecar reads models from — keep in sync with operator-runtime + the Rust sidecar default. */
export function operatorDir(): string {
  const env = process.env['NOETICA_OPERATOR_DIR']
  if (env && env.trim()) return env
  return path.join(os.homedir(), '.noetica', 'operators')
}

/** A model name is safe iff it maps to exactly one file in the operator dir — never traversal. */
export function safeOperatorName(name: string): string | null {
  if (!name || name.length > 128 || name.includes('..')) return null
  if (!/^[A-Za-z0-9._-]+$/.test(name)) return null
  return name
}

export function operatorModelPath(name: string): string | null {
  const safe = safeOperatorName(name)
  return safe ? path.join(operatorDir(), `${safe}.onnx`) : null
}

/** The installed models (every `.onnx` stem in the operator dir). */
export function installedOperators(): string[] {
  try {
    return fs.readdirSync(operatorDir())
      .filter((f) => f.endsWith('.onnx'))
      .map((f) => f.slice(0, -'.onnx'.length))
      .sort()
  } catch { return [] }
}

export interface OperatorManifestEntry { url: string; sha256?: string; version?: string; sizeMb?: number }
export interface OperatorManifest { models?: Record<string, OperatorManifestEntry> }

/** Optional catalogue of downloadable operators (NOETICA_OPERATOR_MANIFEST_URL). Tolerates absence/failure. */
export async function fetchOperatorManifest(): Promise<OperatorManifest | null> {
  const url = process.env['NOETICA_OPERATOR_MANIFEST_URL']?.trim()
  if (!url) return null
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) })
    if (!r.ok) return null
    return (await r.json()) as OperatorManifest
  } catch { return null }
}

const MODEL_URL_ENV = (name: string): string => `NOETICA_OPERATOR_${name.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_URL`

function releaseUrl(name: string): string {
  const base = (process.env['NOETICA_RELEASE_BASE_URL'] || 'https://github.com/SocioProphet/Noetica/releases/latest/download').replace(/\/$/, '')
  return `${base}/${name}-operator.onnx`
}

/** Resolve where a model comes from: explicit env override > manifest entry > the static release asset. */
export async function resolveModelSource(name: string): Promise<{ url: string; sha256: string; version: string }> {
  const env = process.env[MODEL_URL_ENV(name)]?.trim()
  if (env) return { url: env, sha256: '', version: '' }
  const e = (await fetchOperatorManifest())?.models?.[name]
  if (e?.url) return { url: e.url, sha256: e.sha256 ?? '', version: e.version ?? '' }
  return { url: releaseUrl(name), sha256: '', version: '' }
}

/** Allow https anywhere, plus http ONLY on loopback (so the integration test can serve a fixture locally
 *  without weakening the real policy — loopback has no MITM surface). */
function urlAllowed(u: string): boolean {
  try {
    const parsed = new URL(u)
    if (parsed.protocol === 'https:') return true
    return parsed.protocol === 'http:' && (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost')
  } catch { return false }
}

function sha256File(p: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256')
    const s = fs.createReadStream(p)
    s.on('data', (d) => h.update(d as Buffer))
    s.on('end', () => resolve(h.digest('hex')))
    s.on('error', reject)
  })
}

export interface ProvisionProgress { phase: 'downloading' | 'verifying' | 'done'; pct: number | null }
export interface ProvisionResult { ok: boolean; message: string; path?: string }

const MAX_MODEL_BYTES = 2 * 1024 * 1024 * 1024 // 2 GB — generous; refuse a runaway download

/** Download + install a model `.onnx` into the operator dir. Atomic (temp → fsync → rename), integrity-checked
 *  when a sha256 is known, never overwriting the live file until the bytes are complete + verified. */
export async function provisionOperatorModel(name: string, onProgress?: (p: ProvisionProgress) => void): Promise<ProvisionResult> {
  const dest = operatorModelPath(name)
  if (!dest) return { ok: false, message: `invalid model name '${name}'` }
  const { url, sha256: expectedSha } = await resolveModelSource(name)
  if (!urlAllowed(url)) return { ok: false, message: `model URL must be https (or loopback http): got ${url}` }

  fs.mkdirSync(operatorDir(), { recursive: true })
  const tmp = path.join(operatorDir(), `.tmp-${safeOperatorName(name)}-${Date.now()}.onnx`)
  try {
    onProgress?.({ phase: 'downloading', pct: 0 })
    const res = await fetch(url, { signal: AbortSignal.timeout(30 * 60_000) })
    if (!res.ok || !res.body) return { ok: false, message: `download failed: HTTP ${res.status}` }
    const total = Number(res.headers.get('content-length') || 0)
    let seen = 0
    const ws = fs.createWriteStream(tmp)
    const reader = res.body.getReader()
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        seen += value.length
        if (seen > MAX_MODEL_BYTES) { ws.destroy(); return { ok: false, message: `model exceeds ${MAX_MODEL_BYTES} bytes — refusing` } }
        ws.write(Buffer.from(value))
        if (total) onProgress?.({ phase: 'downloading', pct: Math.round((seen / total) * 100) })
      }
    } finally { reader.releaseLock(); ws.end() }
    await new Promise<void>((resolve, reject) => { ws.on('finish', () => resolve()); ws.on('error', reject) })

    if (expectedSha) {
      onProgress?.({ phase: 'verifying', pct: null })
      const got = await sha256File(tmp)
      if (got !== expectedSha) return { ok: false, message: `integrity check FAILED for '${name}' (sha256 mismatch) — refusing to install` }
    }
    // Atomic publish: the sidecar only ever sees the complete, verified file.
    fs.renameSync(tmp, dest)
    onProgress?.({ phase: 'done', pct: 100 })
    return { ok: true, message: `operator '${name}' installed`, path: dest }
  } catch (e) {
    return { ok: false, message: `provisioning failed: ${e instanceof Error ? e.message : String(e)}` }
  } finally {
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp) } catch { /* ignore */ }
  }
}
