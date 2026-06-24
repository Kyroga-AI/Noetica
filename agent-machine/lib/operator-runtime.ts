/**
 * operator-runtime — Noetica's on-device neural-operator inference runtime.
 *
 * Serves ANY ONNX operator model (Fourier Neural Operator surrogates and friends) through the
 * `noetica-operator` Rust + ONNX-Runtime sidecar — the same shape as embed-runtime: a binary lazy-spawned on
 * first use, proxied over localhost HTTP, with a graceful fallback when it isn't present. This is the reusable
 * platform seam: train an operator OFFLINE (once, on a GPU), export it to a single `.onnx`, drop it in
 * ~/.noetica/operators, and it is served on-device with zero cloud. Resolution-invariant operators (FNOs)
 * accept variable spatial dimensions, so one model serves any grid the caller asks for.
 *
 * Why a sidecar and not in-process: the ONNX runtime (a pure-Rust `tract` binary) is a native dependency;
 * isolating it in its own process keeps the agent-machine pure JS/TS, lets a model crash fail soft, and mirrors
 * the embedder we already ship.
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// ── Wire contract (the stable, reusable seam — keep in sync with the Rust sidecar) ───────────────────────
/** A dense tensor: row-major f32 `data` whose length MUST equal the product of `shape`. */
export interface OperatorTensor { shape: number[]; data: number[] }
/** One model input/output port. A `null` dimension is dynamic (e.g. a resolution-invariant spatial axis). */
export interface OperatorIO { name: string; shape: (number | null)[]; dtype: string }
/** A model's input/output signature, read from the ONNX graph by the sidecar. */
export interface OperatorMeta { model: string; inputs: OperatorIO[]; outputs: OperatorIO[] }
/** The result of one inference: named output tensors + wall-clock cost. */
export interface OperatorInferResult { outputs: Record<string, OperatorTensor>; ms: number }

/** Thrown when the sidecar binary isn't installed at all (the caller can degrade / prompt to provision). */
export class OperatorUnavailableError extends Error {
  constructor() { super('noetica-operator sidecar is not available (binary not found)'); this.name = 'OperatorUnavailableError' }
}
/** Thrown when the sidecar is up but the inference itself failed (unknown model, bad input, runtime error). */
export class OperatorError extends Error {
  constructor(message: string, readonly status: number) { super(message); this.name = 'OperatorError' }
}

// A single retrieval/forecast can be large; cap total elements so a bad caller can't OOM the sidecar.
const MAX_ELEMENTS = 8 * 1024 * 1024 // 8M floats (~32 MB) per tensor — far above any sane field grid
const DEFAULT_TIMEOUT_MS = 120_000

// Port/base resolved lazily so tests (and packaged runs) can redirect via NOETICA_OPERATOR_PORT.
const port = (): number => Number(process.env['NOETICA_OPERATOR_PORT']) || 8127
const base = (): string => `http://127.0.0.1:${port()}`

let child: ChildProcess | null = null

/** Locate the sidecar binary: shipped beside the agent-machine binary in the .app (Tauri externalBin), or the
 *  cargo build output in dev. Returns null when neither exists (callers fall back). */
export function operatorBinaryPath(): string | null {
  // Explicit override (packaging / tests): an absolute path, or '' to force "unavailable".
  const override = process.env['NOETICA_OPERATOR_BIN']
  if (override !== undefined) return override && fs.existsSync(override) ? override : null
  const beside = path.join(path.dirname(process.execPath), 'noetica-operator')
  if (fs.existsSync(beside)) return beside
  const here = path.dirname(fileURLToPath(import.meta.url))
  for (const p of [
    path.resolve(process.cwd(), 'operator-sidecar/target/release/noetica-operator'),
    path.resolve(here, '../../operator-sidecar/target/release/noetica-operator'),
  ]) { if (fs.existsSync(p)) return p }
  return null
}

export function isLocalOperatorAvailable(): boolean { return operatorBinaryPath() !== null }

/** Stop the sidecar we spawned (best-effort). For clean shutdown of a CLI/test; the server normally leaves it
 *  running for reuse. Safe to call when nothing was spawned. */
export function shutdownOperator(): void {
  if (child) { try { child.kill('SIGKILL') } catch { /* already gone */ } child = null }
}

async function healthy(): Promise<boolean> {
  try { const r = await fetch(`${base()}/health`, { signal: AbortSignal.timeout(1200) }); return r.ok } catch { return false }
}

let starting: Promise<boolean> | null = null
/** Ensure the sidecar is up (idempotent, races collapsed). False when the binary isn't installed. */
async function ensure(): Promise<boolean> {
  if (await healthy()) return true
  if (starting) return starting
  starting = (async () => {
    const bin = operatorBinaryPath()
    if (!bin) return false
    if (!child || child.exitCode !== null) {
      child = spawn(bin, [], { env: { ...process.env, NOETICA_OPERATOR_PORT: String(port()) }, stdio: 'ignore', detached: false })
      child.on('exit', () => { child = null })
      // The sidecar is a daemon — it must NOT keep our event loop alive (else a CLI/test that finishes its work
      // hangs forever waiting on the still-running child). unref lets the parent exit; the child is reaped by the OS.
      child.unref()
    }
    const deadline = Date.now() + 8000
    while (Date.now() < deadline) { if (await healthy()) return true; await new Promise((r) => setTimeout(r, 250)) }
    return false
  })().finally(() => { starting = null })
  return starting
}

function elementCount(shape: number[]): number {
  return shape.reduce((a, b) => a * b, 1)
}

/** Validate a tensor's element count matches its shape before it ever leaves the process (cheap, catches the
 *  most common caller bug + protects the sidecar). Throws OperatorError on mismatch / oversize. */
function validateTensor(name: string, t: OperatorTensor): void {
  if (!Array.isArray(t.shape) || t.shape.some((d) => !Number.isInteger(d) || d <= 0)) {
    throw new OperatorError(`input '${name}': shape must be positive integers, got ${JSON.stringify(t.shape)}`, 400)
  }
  const n = elementCount(t.shape)
  if (n > MAX_ELEMENTS) throw new OperatorError(`input '${name}': ${n} elements exceeds cap ${MAX_ELEMENTS}`, 400)
  if (!Array.isArray(t.data) || t.data.length !== n) {
    throw new OperatorError(`input '${name}': data length ${t.data?.length} != product(shape) ${n}`, 400)
  }
}

/** The model names currently servable (every `.onnx` the sidecar can see). [] if the sidecar is unavailable. */
export async function listOperators(): Promise<string[]> {
  if (!(await ensure())) return []
  try {
    const r = await fetch(`${base()}/models`, { signal: AbortSignal.timeout(3000) })
    if (!r.ok) return []
    const j = (await r.json()) as { models?: string[] }
    return Array.isArray(j.models) ? j.models : []
  } catch { return [] }
}

/** A model's input/output signature. Throws OperatorUnavailableError / OperatorError. */
export async function operatorMeta(model: string): Promise<OperatorMeta> {
  if (!(await ensure())) throw new OperatorUnavailableError()
  const r = await fetch(`${base()}/meta?model=${encodeURIComponent(model)}`, { signal: AbortSignal.timeout(5000) })
  if (!r.ok) throw new OperatorError(await errText(r), r.status)
  return (await r.json()) as OperatorMeta
}

/** Run one inference. Validates inputs locally first, then proxies to the sidecar.
 *  Throws OperatorUnavailableError (no binary) or OperatorError (model/input/runtime failure). */
export async function operatorInfer(
  model: string,
  inputs: Record<string, OperatorTensor>,
  opts: { timeoutMs?: number } = {},
): Promise<OperatorInferResult> {
  if (!model || typeof model !== 'string') throw new OperatorError('model name is required', 400)
  for (const [name, t] of Object.entries(inputs)) validateTensor(name, t)
  if (!(await ensure())) throw new OperatorUnavailableError()
  let r: Response
  try {
    r = await fetch(`${base()}/infer`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, inputs }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    })
  } catch (e) {
    throw new OperatorError(`sidecar request failed: ${e instanceof Error ? e.message : String(e)}`, 503)
  }
  if (!r.ok) throw new OperatorError(await errText(r), r.status)
  const j = (await r.json()) as OperatorInferResult
  if (!j || typeof j !== 'object' || !j.outputs) throw new OperatorError('sidecar returned malformed result', 502)
  return j
}

/** Convenience: returns null instead of throwing when the sidecar is simply absent, but still surfaces real
 *  inference errors (so a degraded build stays silent while a genuine model bug is loud). */
export async function tryOperatorInfer(
  model: string, inputs: Record<string, OperatorTensor>, opts: { timeoutMs?: number } = {},
): Promise<OperatorInferResult | null> {
  try { return await operatorInfer(model, inputs, opts) }
  catch (e) { if (e instanceof OperatorUnavailableError) return null; throw e }
}

async function errText(r: Response): Promise<string> {
  try {
    const j = (await r.json()) as { error?: string }
    if (j?.error) return j.error
  } catch { /* not json */ }
  return `sidecar HTTP ${r.status}`
}
