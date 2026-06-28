import { test, before, after, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import * as http from 'node:http'
import {
  operatorInfer, tryOperatorInfer, operatorMeta, listOperators,
  OperatorError, OperatorUnavailableError,
} from './operator-runtime.js'

// A mock sidecar lets us verify the runtime's proxy/validation/error contract WITHOUT the native binary —
// the same hermetic approach as the embedder + fallback tests. The runtime resolves port/base lazily, so we
// point NOETICA_OPERATOR_PORT at the mock and NOETICA_OPERATOR_BIN at the mock's "binary" (any real path so
// operatorBinaryPath() is non-null and ensure() trusts the already-listening mock instead of spawning).
let server: http.Server
let lastBody: any = null
const PORT = 8231

function start(): Promise<void> {
  server = http.createServer((req, res) => {
    const send = (code: number, obj: unknown) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)) }
    if (req.method === 'GET' && req.url === '/health') return send(200, { ok: true, models: ['identity'] })
    if (req.method === 'GET' && req.url === '/models') return send(200, { models: ['identity', 'darcy-fno'] })
    if (req.method === 'GET' && req.url?.startsWith('/meta')) {
      const model = new URL(req.url, 'http://x').searchParams.get('model')
      if (model === 'identity') return send(200, { model, inputs: [{ name: 'x', shape: [1, 1, null, null], dtype: 'f32' }], outputs: [{ name: 'y', shape: [1, 1, null, null], dtype: 'f32' }] })
      return send(404, { error: `unknown model '${model}'` })
    }
    if (req.method === 'POST' && req.url === '/infer') {
      let raw = ''
      req.on('data', (c) => (raw += c))
      req.on('end', () => {
        lastBody = JSON.parse(raw)
        if (lastBody.model === 'identity') {
          const x = lastBody.inputs.x
          return send(200, { outputs: { y: { shape: x.shape, data: x.data } }, ms: 3 }) // echo = identity operator
        }
        return send(404, { error: `unknown model '${lastBody.model}'` })
      })
      return
    }
    send(404, { error: 'not found' })
  })
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(PORT, '127.0.0.1', () => resolve()) })
}

before(() => start())
after(() => server?.close())
beforeEach(() => {
  process.env['NOETICA_OPERATOR_PORT'] = String(PORT)
  process.env['NOETICA_OPERATOR_BIN'] = process.execPath // any existing file → binaryPath non-null → trust the mock
})
afterEach(() => { delete process.env['NOETICA_OPERATOR_PORT']; delete process.env['NOETICA_OPERATOR_BIN'] })

test('listOperators returns the served models', async () => {
  assert.deepEqual((await listOperators()).sort(), ['darcy-fno', 'identity'])
})

test('operatorMeta exposes the io signature incl. dynamic (null) dims', async () => {
  const m = await operatorMeta('identity')
  assert.equal(m.inputs[0]!.name, 'x')
  assert.deepEqual(m.inputs[0]!.shape, [1, 1, null, null]) // resolution-invariant spatial axes
})

test('operatorMeta surfaces an unknown model as OperatorError(404)', async () => {
  await assert.rejects(() => operatorMeta('nope'), (e) => e instanceof OperatorError && (e as OperatorError).status === 404)
})

test('operatorInfer round-trips a field through the (identity) operator', async () => {
  const data = Array.from({ length: 16 }, (_, i) => i / 16)
  const r = await operatorInfer('identity', { x: { shape: [1, 1, 4, 4], data } })
  assert.deepEqual(r.outputs.y!.shape, [1, 1, 4, 4])
  assert.deepEqual(r.outputs.y!.data, data)
  assert.equal(typeof r.ms, 'number')
})

test('operatorInfer rejects a shape/data mismatch BEFORE any network call', async () => {
  // 4x4 = 16 elements but only 10 provided — must throw locally, and never reach the mock.
  lastBody = null
  await assert.rejects(
    () => operatorInfer('identity', { x: { shape: [1, 1, 4, 4], data: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] } }),
    (e) => e instanceof OperatorError && (e as OperatorError).status === 400 && /data length 10 != product\(shape\) 16/.test((e as Error).message),
  )
  assert.equal(lastBody, null, 'a malformed tensor must not be sent to the sidecar')
})

test('operatorInfer rejects a non-positive shape', async () => {
  await assert.rejects(
    () => operatorInfer('identity', { x: { shape: [1, 0, 4], data: [] } }),
    (e) => e instanceof OperatorError && (e as OperatorError).status === 400,
  )
})

test('tryOperatorInfer returns null when the sidecar binary is absent (degrade), not throw', async () => {
  process.env['NOETICA_OPERATOR_BIN'] = '' // force operatorBinaryPath() → null → ensure() false
  process.env['NOETICA_OPERATOR_PORT'] = '8232' // nothing listening here
  assert.equal(await tryOperatorInfer('identity', { x: { shape: [1], data: [0] } }), null)
})

test('operatorInfer throws OperatorUnavailableError when the binary is absent', async () => {
  process.env['NOETICA_OPERATOR_BIN'] = ''
  process.env['NOETICA_OPERATOR_PORT'] = '8232'
  await assert.rejects(() => operatorInfer('identity', { x: { shape: [1], data: [0] } }), OperatorUnavailableError)
})
