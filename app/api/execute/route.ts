import { NextResponse } from 'next/server'
import { spawn } from 'child_process'
import * as os from 'os'
import * as path from 'path'
import * as fs from 'fs'

export const runtime = 'nodejs'

const TIMEOUT_MS = 30_000   // 30 s — longer for data analysis
const MAX_OUTPUT = 100_000

// Runner executed in an ISOLATED Node subprocess (separate PID) for user JavaScript.
// The code is read from a file (NJS_FILE) and run under vm.createContext with no Node
// APIs exposed. node:vm is not a security boundary, so this must never run in the main
// Next.js process — an escape there would reach the server's secrets + host filesystem.
const JS_VM_RUNNER = `
const fs = require('fs'), vm = require('vm');
const code = fs.readFileSync(process.env.NJS_FILE, 'utf8');
const logs = [];
const consoleMock = {
  log:   (...a) => logs.push(a.map(String).join(' ')),
  error: (...a) => logs.push('ERROR: ' + a.map(String).join(' ')),
  warn:  (...a) => logs.push('WARN: '  + a.map(String).join(' ')),
  info:  (...a) => logs.push('INFO: '  + a.map(String).join(' ')),
  table: (...a) => logs.push(JSON.stringify(a[0], null, 2)),
};
const sandbox = {
  console: consoleMock, Math, JSON, Array, Object, String, Number, Boolean, Date, Error, Map, Set,
  Promise, parseInt, parseFloat, isNaN, isFinite, encodeURIComponent, decodeURIComponent,
  require: undefined, process: undefined, global: undefined, Buffer: undefined,
  __dirname: undefined, __filename: undefined, setTimeout: undefined, setInterval: undefined, fetch: undefined,
};
try {
  vm.createContext(sandbox);
  const result = vm.runInContext(code, sandbox, { timeout: ${TIMEOUT_MS} });
  const out = logs.join('\\n');
  const rl = (result !== undefined && result !== null)
    ? '\\nResult: ' + (typeof result === 'object' ? JSON.stringify(result, null, 2) : String(result)) : '';
  process.stdout.write((out + rl).trim() || '(no output)');
} catch (e) { process.stdout.write('RuntimeError: ' + (e && e.message ? e.message : String(e))); }
`

// ─── Session state for persistent Python sandboxes ────────────────────────────
// Each session_id gets a shared tmp directory that persists between calls.
// Files written there are auto-detected and returned as base64 outputs.

const SESSION_DIRS = new Map<string, string>()

function getSessionDir(sessionId: string): string {
  if (SESSION_DIRS.has(sessionId)) return SESSION_DIRS.get(sessionId)!
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `noetica-py-${sessionId.slice(0, 8)}-`))
  SESSION_DIRS.set(sessionId, dir)
  return dir
}

// Snapshot existing file mtimes so we can detect new/modified files after execution
function snapshotFiles(dir: string): Map<string, number> {
  const snap = new Map<string, number>()
  try {
    for (const f of fs.readdirSync(dir)) {
      const stat = fs.statSync(path.join(dir, f))
      snap.set(f, stat.mtimeMs)
    }
  } catch { /* dir may not exist yet */ }
  return snap
}

function collectNewFiles(dir: string, before: Map<string, number>): Array<{ name: string; base64: string; mimeType: string }> {
  const results: Array<{ name: string; base64: string; mimeType: string }> = []
  try {
    for (const f of fs.readdirSync(dir)) {
      const stat = fs.statSync(path.join(dir, f))
      const prev = before.get(f)
      if (!prev || stat.mtimeMs > prev) {
        // New or modified file — read and base64-encode
        if (stat.size > 5 * 1024 * 1024) continue  // skip > 5 MB
        const bytes = fs.readFileSync(path.join(dir, f))
        const ext = f.split('.').pop()?.toLowerCase() ?? ''
        const mime =
          ext === 'png'  ? 'image/png' :
          ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' :
          ext === 'svg'  ? 'image/svg+xml' :
          ext === 'csv'  ? 'text/csv' :
          ext === 'json' ? 'application/json' :
          ext === 'html' ? 'text/html' :
          ext === 'pdf'  ? 'application/pdf' :
          'application/octet-stream'
        results.push({ name: f, base64: bytes.toString('base64'), mimeType: mime })
      }
    }
  } catch { /* ignore */ }
  return results
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  const body = (await request.json()) as { language?: string; code?: string; session_id?: string }
  const language  = body.language
  const code      = body.code?.trim()
  const sessionId = body.session_id ?? 'default'

  if (!code) {
    return NextResponse.json({ error: 'code_required' }, { status: 400 })
  }
  if (language !== 'python' && language !== 'javascript') {
    return NextResponse.json({ error: 'unsupported_language', supported: ['python', 'javascript'] }, { status: 400 })
  }

  const started = Date.now()

  // ── JavaScript via an isolated Node subprocess ─────────────────────────────
  if (language === 'javascript') {
    // Never run user JS in this process — node:vm is not a security boundary, so an escape
    // would reach the Next.js runtime, its secrets, and the host filesystem. Stage the code
    // to a file and execute it in a separate Node PID with a secret-free env (mirrors Python).
    const sessionDir = getSessionDir(sessionId)
    const jsFile = path.join(sessionDir, `_jsrun_${Date.now()}_${Math.random().toString(36).slice(2)}.js`)
    try { fs.writeFileSync(jsFile, code, { mode: 0o600 }) }
    catch { return NextResponse.json({ output: 'RuntimeError: could not stage code for execution', exit_code: 1, runtime_ms: Date.now() - started, language, files: [] }) }

    return new Promise<Response>((resolve) => {
      let stdout = ''
      let stderr = ''
      let timedOut = false
      const safeEnv: NodeJS.ProcessEnv = { NODE_ENV: process.env['NODE_ENV'] ?? 'production', NJS_FILE: jsFile }
      for (const k of ['PATH', 'HOME', 'USER', 'LANG', 'LC_ALL', 'TMPDIR', 'TZ']) {
        const v = process.env[k]; if (v !== undefined) safeEnv[k] = v
      }
      const proc = spawn(process.execPath, ['-e', JS_VM_RUNNER], { cwd: sessionDir, env: safeEnv })
      const cleanup = () => { try { fs.unlinkSync(jsFile) } catch { /* */ } }
      const timer = setTimeout(() => { timedOut = true; proc.kill('SIGKILL') }, TIMEOUT_MS)
      proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); if (stdout.length > MAX_OUTPUT) proc.kill('SIGPIPE') })
      proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
      proc.on('close', (exitCode) => {
        clearTimeout(timer); cleanup()
        const runtime_ms = Date.now() - started
        if (timedOut) { resolve(NextResponse.json({ output: 'TimeoutError: execution exceeded 30 seconds.', exit_code: 124, runtime_ms, language, files: [] })); return }
        const out = stdout.slice(0, MAX_OUTPUT).trimEnd()
        const err = stderr.slice(0, 4000).trimEnd()
        const output = [out, err ? `Stderr:\n${err}` : ''].filter(Boolean).join('\n\n').trim() || `(exit ${exitCode ?? 0}, no output)`
        resolve(NextResponse.json({ output, exit_code: exitCode ?? 0, runtime_ms, language, files: [] }))
      })
      proc.on('error', (e) => { clearTimeout(timer); cleanup(); resolve(NextResponse.json({ output: `SpawnError: ${e.message}`, exit_code: -1, runtime_ms: Date.now() - started, language, files: [] })) })
    })
  }

  // ── Python via subprocess — persistent session directory ──────────────────
  const sessionDir = getSessionDir(sessionId)
  const beforeSnap = snapshotFiles(sessionDir)

  // Inject matplotlib backend + output directory into every execution
  const preamble = `
import sys, os
os.chdir(${JSON.stringify(sessionDir)})
try:
  import matplotlib
  matplotlib.use('Agg')
  import matplotlib.pyplot as plt
  _plt_show_orig = plt.show
  def _plt_show_patched(*a, **kw):
    import datetime
    fname = 'plot_' + datetime.datetime.now().strftime('%H%M%S%f') + '.png'
    plt.savefig(fname, dpi=150, bbox_inches='tight')
    print(f'[chart:{fname}]')
    plt.clf()
  plt.show = _plt_show_patched
except ImportError:
  pass
`

  const fullCode = preamble + '\n' + code

  return new Promise<Response>((resolve) => {
    let stdout = ''
    let stderr = ''
    let timedOut = false

    // Secret-free env: only what Python needs to run, never the parent's secrets (API keys, tokens). Mirrors
    // the agent-machine's executeCode/run_command hardening so this dev route can't leak credentials either.
    const safeEnv: NodeJS.ProcessEnv = { NODE_ENV: process.env['NODE_ENV'] ?? 'production', PYTHONDONTWRITEBYTECODE: '1', MPLBACKEND: 'Agg' }
    for (const k of ['PATH', 'HOME', 'USER', 'LANG', 'LC_ALL', 'TMPDIR', 'TZ']) {
      const v = process.env[k]; if (v !== undefined) safeEnv[k] = v
    }
    const proc = spawn('python3', ['-c', fullCode], {
      cwd: sessionDir,
      env: safeEnv,
    })

    const timer = setTimeout(() => {
      timedOut = true
      proc.kill('SIGKILL')
    }, TIMEOUT_MS)

    proc.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
      if (stdout.length > MAX_OUTPUT) proc.kill('SIGPIPE')
    })
    proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })

    proc.on('close', (exitCode) => {
      clearTimeout(timer)
      const runtime_ms = Date.now() - started

      if (timedOut) {
        resolve(NextResponse.json({ output: 'TimeoutError: execution exceeded 30 seconds.', exit_code: 124, runtime_ms, language, files: [] }))
        return
      }

      const out  = stdout.slice(0, MAX_OUTPUT).trimEnd()
      const err  = stderr.slice(0, 4000).trimEnd()
      const parts = [out, err ? `Stderr:\n${err}` : ''].filter(Boolean)
      const output = parts.join('\n\n').trim() || `(exit ${exitCode ?? 0}, no output)`

      const files = collectNewFiles(sessionDir, beforeSnap)
      resolve(NextResponse.json({ output, exit_code: exitCode ?? 0, runtime_ms, language, files }))
    })

    proc.on('error', (e) => {
      clearTimeout(timer)
      resolve(NextResponse.json({ output: `SpawnError: ${e.message}`, exit_code: -1, runtime_ms: Date.now() - started, language, files: [] }))
    })
  })
}
