/**
 * End-to-end guard for the on-device neural-operator stack: the REAL operator-runtime driving the REAL
 * noetica-operator sidecar (ONNX Runtime) against the checked-in reference fixtures. No mocks — this is the
 * exact path a trained Fourier Neural Operator flows through.
 *
 * Skips (does not fail) when the Rust binary isn't built, so the light unit job stays cargo-free; a dedicated
 * job / local run builds the sidecar first. Build: `cd operator-sidecar && cargo build --release`.
 *
 * Run: npm run test:integration:operator
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const sidecarRoot = path.resolve(here, '../../operator-sidecar')
const modelsDir = path.join(sidecarRoot, 'models')
const binCandidates = [
  path.join(sidecarRoot, 'target/release/noetica-operator'),
  path.join(sidecarRoot, 'target/debug/noetica-operator'),
]
const bin = binCandidates.find((p) => fs.existsSync(p))
const haveFixtures = fs.existsSync(path.join(modelsDir, 'identity.onnx'))
const SKIP = !bin || !haveFixtures
const reason = !bin ? 'sidecar binary not built (cargo build in operator-sidecar)' : !haveFixtures ? 'reference fixtures missing' : ''

const TEST_PORT = 8234

// operator-runtime reads these lazily, so set them before importing it.
process.env['NOETICA_OPERATOR_PORT'] = String(TEST_PORT)
if (bin) process.env['NOETICA_OPERATOR_BIN'] = bin
process.env['NOETICA_OPERATOR_DIR'] = modelsDir

// Imported dynamically so a missing binary skips cleanly without spawn side effects at import.
let rt: typeof import('../lib/operator-runtime.js')

before(async () => { if (!SKIP) rt = await import('../lib/operator-runtime.js') })
after(() => { rt?.shutdownOperator?.() }) // kill the spawned sidecar so the test process exits cleanly

test('lists the reference operators', { skip: SKIP && reason }, async () => {
  const models = await rt.listOperators()
  assert.ok(models.includes('identity'), `identity should be served; got ${JSON.stringify(models)}`)
  assert.ok(models.includes('smooth'))
})

test('meta exposes the resolution-invariant (dynamic) spatial axes', { skip: SKIP && reason }, async () => {
  const m = await rt.operatorMeta('smooth')
  assert.equal(m.inputs[0]!.name, 'x')
  assert.equal(m.inputs[0]!.dtype, 'Float32')
  assert.deepEqual(m.inputs[0]!.shape, [1, 1, null, null]) // H, W dynamic — one model, any grid
})

test('identity operator round-trips a field byte-for-byte', { skip: SKIP && reason }, async () => {
  const data = [1, 2, 3, 4, 5, 6]
  const r = await rt.operatorInfer('identity', { x: { shape: [1, 1, 2, 3], data } })
  assert.deepEqual(r.outputs.y!.shape, [1, 1, 2, 3])
  assert.deepEqual(r.outputs.y!.data, data)
})

test('smooth operator computes a correct zero-padded 3x3 mean filter', { skip: SKIP && reason }, async () => {
  // Constant field of 1.0 → interior = 9/9 = 1, edges = 6/9, corners = 4/9 (zero padding outside).
  const r = await rt.operatorInfer('smooth', { x: { shape: [1, 1, 3, 3], data: Array(9).fill(1) } })
  const y = r.outputs.y!.data
  const approx = (a: number, b: number) => Math.abs(a - b) < 1e-5
  assert.ok(approx(y[4]!, 1.0), `center should be 1.0, got ${y[4]}`)
  assert.ok(approx(y[1]!, 6 / 9), `edge should be 0.666, got ${y[1]}`)
  assert.ok(approx(y[0]!, 4 / 9), `corner should be 0.444, got ${y[0]}`)
})

test('resolution-invariance: the SAME operator runs at a different grid size', { skip: SKIP && reason }, async () => {
  // 5x5 — a different resolution than above. The center of a constant field is still exactly 1.0.
  const r = await rt.operatorInfer('smooth', { x: { shape: [1, 1, 5, 5], data: Array(25).fill(1) } })
  assert.deepEqual(r.outputs.y!.shape, [1, 1, 5, 5])
  assert.ok(Math.abs(r.outputs.y!.data[12]! - 1.0) < 1e-5, 'interior of a 5x5 constant field stays 1.0')
})

test('a malformed tensor is rejected, the sidecar stays healthy for the next call', { skip: SKIP && reason }, async () => {
  await assert.rejects(() => rt.operatorInfer('identity', { x: { shape: [1, 1, 2, 2], data: [1, 2, 3] } }))
  // still serving (the model signature is rank-4, so use a valid 1x1x1x1 field):
  const r = await rt.operatorInfer('identity', { x: { shape: [1, 1, 1, 1], data: [42] } })
  assert.deepEqual(r.outputs.y!.data, [42])
})

test('a shape-product OVERFLOW is rejected by the sidecar (no crash) — hits /infer directly', { skip: SKIP && reason }, async () => {
  // The TS client would block this on its own (JS numbers don't wrap), so we POST RAW to the sidecar to
  // exercise the Rust-side guard. shape [2^31,2^31,2^31] i64-products to 0 (wraps) — pre-fix that passed
  // validation with an empty buffer and SIGSEGV'd ONNX Runtime, killing the single-threaded sidecar.
  await rt.operatorInfer('identity', { x: { shape: [1, 1, 1, 1], data: [1] } }) // ensure the sidecar is up
  const base = `http://127.0.0.1:${process.env['NOETICA_OPERATOR_PORT']}`
  const evil = await fetch(`${base}/infer`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'identity', inputs: { x: { shape: [2147483648, 2147483648, 2147483648], data: [] } } }),
  })
  assert.equal(evil.status, 400, 'overflow shape must be rejected, not crash the sidecar')
  // The sidecar must still be alive + serving afterwards.
  const health = await fetch(`${base}/health`)
  assert.equal(health.status, 200)
  const ok = await rt.operatorInfer('identity', { x: { shape: [1, 1, 1, 1], data: [7] } })
  assert.deepEqual(ok.outputs.y!.data, [7])
})
