/**
 * code-sandbox — hardened execution layer for model-authored Python and JavaScript.
 *
 * Security design (defense-in-depth):
 *
 *   Python  — subprocess + POSIX resource limits (memory cap, max processes, no core dump) + filtered
 *             env + cwd pinned to the session workspace. Network access is intentionally permitted (the
 *             sandbox is compute isolation, not network isolation — a higher-level connector policy governs
 *             egress). On Linux, the preamble also calls resource.setrlimit for an extra layer.
 *
 *   JavaScript — subprocess running Node's vm.createContext in a separate PID (proper process isolation).
 *               The sandbox exposes no Node.js APIs: no require, no process, no __dirname, no global.
 *               If the isolated subprocess runner cannot be spawned (e.g. no writable temp dir), execution
 *               fails closed with an error — it never falls back to running model code in this process,
 *               because node:vm is not a security boundary and an escape would reach the main runtime.
 *
 * This module is pure and dependency-injectable for testing. server.ts swaps the real cp.spawn in.
 */

import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import * as cp from "node:child_process";

export const EXEC_TIMEOUT_MS = 30_000;
export const MAX_OUTPUT_BYTES = 100_000;

// ── Python preamble ──────────────────────────────────────────────────────────

/** Prepended to every Python execution. Sets resource limits + session cwd. */
export function buildPythonPreamble(sessionDir: string): string {
  // JSON.stringify safely embeds the path as a Python string literal.
  const escapedDir = JSON.stringify(sessionDir);
  return `
import sys, os
os.chdir(${escapedDir})

# Resource limits — run before any user code.
try:
  import resource
  # 256 MB virtual memory; 64 MB data segment; 64 child processes; no core dumps.
  MB = 1024 * 1024
  resource.setrlimit(resource.RLIMIT_AS,    (256 * MB, 256 * MB))
  resource.setrlimit(resource.RLIMIT_DATA,  (64 * MB,  64 * MB))
  resource.setrlimit(resource.RLIMIT_NPROC, (64, 64))
  resource.setrlimit(resource.RLIMIT_CORE,  (0, 0))
except (ImportError, ValueError, resource.error):
  pass  # macOS may reject RLIMIT_AS; best-effort

# Matplotlib non-interactive backend so plt.show() saves to disk.
try:
  import matplotlib
  matplotlib.use('Agg')
  import matplotlib.pyplot as plt
  import datetime as _dt
  def _patched_show(*a, **kw):
    fname = 'plot_' + _dt.datetime.now().strftime('%H%M%S%f') + '.png'
    plt.savefig(fname, dpi=150, bbox_inches='tight')
    print(f'[chart:{fname}]')
    plt.clf()
  plt.show = _patched_show
except ImportError:
  pass
`;
}

/** Environment passed to the Python subprocess — secrets stripped. */
export function buildSafeEnv(): Record<string, string> {
  const safeEnv: Record<string, string> = {};
  const allowed = new Set(["PATH", "HOME", "LANG", "TMPDIR", "PYTHONPATH"]);
  for (const k of allowed) {
    const v = process.env[k];
    if (v) safeEnv[k] = v;
  }
  safeEnv["PYTHONDONTWRITEBYTECODE"] = "1";
  safeEnv["MPLBACKEND"] = "Agg";
  // Defensive strip: even if a future caller adds a secret-shaped var to the
  // allowlist above, it will be removed here.
  for (const k of Object.keys(safeEnv)) {
    if (/KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL/i.test(k)) delete safeEnv[k];
  }
  return safeEnv;
}

// ── JavaScript subprocess runner ─────────────────────────────────────────────

/** Node.js runner script: vm.createContext inside a fresh PID → real process isolation. */
const JS_VM_RUNNER = `
const fs = require('fs'), vm = require('vm'), v8 = require('v8');
const code = fs.readFileSync(process.env['NJS_FILE'], 'utf8');
const logs = [];
const consoleMock = {
  log:   (...a) => logs.push(a.map(String).join(' ')),
  error: (...a) => logs.push('ERROR: ' + a.map(String).join(' ')),
  warn:  (...a) => logs.push('WARN: '  + a.map(String).join(' ')),
  info:  (...a) => logs.push('INFO: '  + a.map(String).join(' ')),
};
// Explicit sandbox — only pure computations; no Node.js APIs exposed.
const sandbox = {
  console: consoleMock, Math, JSON, Array, Object, String, Number,
  Boolean, Date, Error, Map, Set, WeakMap, WeakSet, Symbol, BigInt,
  Promise, RegExp, Proxy, Reflect,
  parseInt, parseFloat, isNaN, isFinite, isFinite,
  encodeURIComponent, decodeURIComponent, encodeURI, decodeURI,
  // Explicitly blocked — redundant given the above, but explicit is safer.
  require: undefined, process: undefined, global: undefined,
  __dirname: undefined, __filename: undefined, Buffer: undefined,
};
try {
  vm.createContext(sandbox);
  const r = vm.runInContext(code, sandbox, { timeout: ${EXEC_TIMEOUT_MS} });
  const out = logs.join('\\n');
  const rl = (r !== undefined && r !== null)
    ? '\\nResult: ' + (typeof r === 'object' ? JSON.stringify(r, null, 2) : String(r))
    : '';
  process.stdout.write((out + rl).trim() || '(no output)');
} catch(e) {
  process.stdout.write('RuntimeError: ' + (e && e.message ? e.message : String(e)));
}
`;

// ── OS-level credential confinement ──────────────────────────────────────────
// node:vm is not a security boundary — a determined escape (via Object/Array → Function constructor)
// reaches `require`/`process` inside the subprocess. The subprocess already carries no secrets in its
// env, but an escape could still READ credential files (~/.ssh, ~/.aws, the at-rest key) and exfiltrate
// them. On macOS we wrap the subprocess in sandbox-exec with a blacklist profile that denies reads of
// those credential locations while leaving compute/network/startup untouched. Probe-guarded: if the
// profile can't run, we skip wrapping rather than break execution. Disable with NOETICA_SANDBOX_EXEC=0.

let _sandboxPrefixCache: string[] | null | undefined;

function sandboxProfile(): string {
  const home = os.homedir();
  const sub = (p: string) => `(subpath ${JSON.stringify(path.join(home, p))})`;
  const noeticaEsc = path.join(home, '.noetica').replace(/[.[\]{}()*+?^$|\\/]/g, '\\$&');
  return [
    '(version 1)',
    '(allow default)',
    // Deny reads of credential/secret directories even under a vm escape.
    `(deny file-read* ${sub('.ssh')} ${sub('.aws')} ${sub('.gnupg')} ${sub('.config/gcloud')} ${sub('.config/gh')} ${sub('.kube')} ${sub('.docker')} ${sub('.netrc')})`,
    // Deny reads of the at-rest key material + sidecar token (they live in ~/.noetica alongside data
    // the subprocess legitimately reads, so target the secret files specifically, not the whole dir).
    `(deny file-read* (regex #"^${noeticaEsc}/.*\\.key$"))`,
    `(deny file-read* (literal ${JSON.stringify(path.join(home, '.noetica', 'sidecar-token'))}))`,
  ].join(' ');
}

/** Returns the `sandbox-exec -p <profile>` argv prefix if it's available AND verified to run, else null. */
export function sandboxExecPrefix(): string[] | null {
  if (_sandboxPrefixCache !== undefined) return _sandboxPrefixCache;
  _sandboxPrefixCache = null;
  try {
    if (process.platform !== 'darwin') return _sandboxPrefixCache;
    if (process.env['NOETICA_SANDBOX_EXEC'] === '0') return _sandboxPrefixCache;
    if (!fs.existsSync('/usr/bin/sandbox-exec')) return _sandboxPrefixCache;
    const profile = sandboxProfile();
    // Probe once: only enable wrapping if the profile actually loads and runs a no-op.
    cp.execFileSync('/usr/bin/sandbox-exec', ['-p', profile, '/usr/bin/true'], { stdio: 'ignore', timeout: 5000 });
    _sandboxPrefixCache = ['/usr/bin/sandbox-exec', '-p', profile];
  } catch { _sandboxPrefixCache = null; }
  return _sandboxPrefixCache;
}

/** Wrap [cmd, ...args] with the credential-confinement sandbox when available. */
function withSandbox(cmd: string, args: string[]): { cmd: string; args: string[] } {
  const prefix = sandboxExecPrefix();
  return prefix ? { cmd: prefix[0]!, args: [...prefix.slice(1), cmd, ...args] } : { cmd, args };
}

// ── Subprocess helper ────────────────────────────────────────────────────────

export interface SpawnFn {
  (cmd: string, args: string[], opts: cp.SpawnOptions): cp.ChildProcess;
}

function runSubprocess(
  cmd: string,
  args: string[],
  opts: cp.SpawnOptions,
  timeoutMs: number,
  onComplete: (output: string) => void,
): void {
  let stdout = "";
  let stderr = "";
  let timedOut = false;

  const proc = cp.spawn(cmd, args, opts);
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill("SIGKILL");
  }, timeoutMs);

  proc.stdout!.on("data", (chunk: Buffer) => {
    stdout += chunk.toString();
    if (stdout.length > MAX_OUTPUT_BYTES) proc.kill("SIGPIPE");
  });
  proc.stderr!.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  proc.on("close", (code) => {
    clearTimeout(timer);
    if (timedOut) { onComplete(`TimeoutError: execution exceeded ${timeoutMs / 1000}s`); return; }
    const out = stdout.slice(0, MAX_OUTPUT_BYTES).trimEnd();
    const err = stderr.slice(0, 4000).trimEnd();
    onComplete([out, err ? `Stderr:\n${err}` : ""].filter(Boolean).join("\n\n").trim() || `(exit ${code ?? 0}, no output)`);
  });
}

// ── Public API ───────────────────────────────────────────────────────────────

export interface SandboxResult {
  output: string;
  timedOut: boolean;
}

/**
 * Execute Python code in a hardened subprocess.
 * `sessionDir` must already exist; code runs inside it with restricted env.
 */
export function executePython(code: string, sessionDir: string): Promise<string> {
  const preamble = buildPythonPreamble(sessionDir);
  const fullCode = preamble + "\n" + code;
  const w = withSandbox("python3", ["-c", fullCode]);
  return new Promise((resolve) => {
    runSubprocess(
      w.cmd, w.args,
      { cwd: sessionDir, env: buildSafeEnv() as NodeJS.ProcessEnv },
      EXEC_TIMEOUT_MS,
      resolve,
    );
  });
}

/**
 * Execute JavaScript code.
 * If Node.js is available as a subprocess runtime, uses proper process isolation.
 * Falls back to in-process vm with memory limit (constrained machines only).
 */
export function executeJavaScript(code: string, sessionDir: string, nodeExecPath?: string): Promise<string> {
  const runtime = nodeExecPath ?? process.execPath;

  // Write code to a temp file so the runner subprocess can read it.
  const tmpDir = os.tmpdir();
  const njsFile = path.join(tmpDir, `noetica-js-${Date.now()}-${Math.random().toString(36).slice(2)}.js`);
  try { fs.writeFileSync(njsFile, code, { mode: 0o600 }); } catch { /* fall through to in-process */ }

  if (fs.existsSync(njsFile)) {
    const w = withSandbox(runtime, ["-e", JS_VM_RUNNER]);
    return new Promise((resolve) => {
      const cleanup = () => { try { fs.unlinkSync(njsFile); } catch { /* ignore */ } };
      runSubprocess(
        w.cmd, w.args,
        {
          cwd: sessionDir,
          env: { NJS_FILE: njsFile, PATH: process.env["PATH"] ?? "" } as unknown as NodeJS.ProcessEnv,
        },
        EXEC_TIMEOUT_MS,
        (output) => { cleanup(); resolve(output); },
      );
    });
  }

  // No writable temp dir → the isolated subprocess runner cannot be spawned.
  // Refuse rather than fall back to an in-process vm: node:vm is NOT a security
  // boundary (the Node docs say so explicitly). A sandbox escape running in this
  // process would reach the main Noetica runtime, its secrets, and the host
  // filesystem — a far worse outcome than declining to run. Fail closed.
  return Promise.resolve(
    "ExecutionError: JavaScript execution is unavailable on this host " +
      "(no writable temporary directory for the isolated runner).",
  );
}
