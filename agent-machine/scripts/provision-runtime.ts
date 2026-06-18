/**
 * Provision the app-owned model runtime into ~/.noetica/runtime/.
 *
 * Downloads a COMPLETE Ollama (binary + lib/ollama runner — the piece the dmg
 * shipped without, which caused the freeze) into the app data dir, so the T2
 * seatbelt provider runs the app's own runtime with zero host install. Idempotent:
 * a version stamp skips re-download. macOS (universal .tgz) here; Linux uses the
 * container image instead.
 *
 *   npm run provision:runtime          # download if missing
 *   OLLAMA_VERSION=0.30.8 npm run provision:runtime
 */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
const exec = promisify(execFile)

const VERSION = process.env['OLLAMA_VERSION'] ?? '0.30.8'
const RUNTIME = path.join(os.homedir(), '.noetica', 'runtime')
const BIN = path.join(RUNTIME, 'ollama')
const STAMP = path.join(RUNTIME, '.version')

// The inference runner is `llama-server` + its dylibs. macOS extracts these FLAT
// alongside `ollama`; Linux puts them under lib/ollama/. The original dmg bug was
// shipping `ollama` WITHOUT these siblings → "llama-server binary not found".
function complete(): boolean {
  if (!fs.existsSync(BIN)) return false
  return fs.existsSync(path.join(RUNTIME, 'llama-server'))
    || fs.existsSync(path.join(RUNTIME, 'lib', 'ollama', 'llama-server'))
}

async function main() {
  if (process.platform !== 'darwin') {
    console.log('[provision] non-macOS: model runtime ships as a container image, not a host binary — skipping')
    return
  }
  if (complete() && fs.existsSync(STAMP) && fs.readFileSync(STAMP, 'utf8').trim() === VERSION) {
    console.log(`[provision] runtime already complete at ${RUNTIME} (v${VERSION}) — binary + lib/ollama runner present`)
    return
  }
  fs.mkdirSync(RUNTIME, { recursive: true })
  const url = `https://github.com/ollama/ollama/releases/download/v${VERSION}/ollama-darwin.tgz`
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'noetica-rt-'))
  const archive = path.join(tmp, 'ollama.tgz')
  console.log(`[provision] downloading complete Ollama ${VERSION} → ${RUNTIME}`)
  await exec('curl', ['-fsSL', url, '-o', archive])
  // Extract the full archive (binary + lib/ollama runner) into the runtime dir.
  await exec('tar', ['-xzf', archive, '-C', RUNTIME])
  fs.chmodSync(BIN, 0o755)
  fs.rmSync(tmp, { recursive: true, force: true })
  if (!complete()) {
    console.error(`[provision] FAILED: llama-server runner missing after extract — runtime would be unable to run inference`)
    process.exit(1)
  }
  fs.writeFileSync(STAMP, VERSION)
  console.log(`[provision] ✓ complete runtime: ${BIN} + llama-server runner present — v${VERSION}`)
}
main().catch((e) => { console.error('[provision] error:', e instanceof Error ? e.message : e); process.exit(1) })
