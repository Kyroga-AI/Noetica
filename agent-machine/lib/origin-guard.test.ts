/** Tests for the drive-by CSRF / DNS-rebinding origin guard. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isLoopbackOrigin, originAllowed } from './origin-guard.js'

test('loopback + desktop-shell origins are recognized', () => {
  for (const o of [
    'http://localhost:3000', 'http://127.0.0.1:8080', 'http://localhost', 'https://127.0.0.1',
    'http://[::1]:5173', 'http://0.0.0.0:8080', 'http://app.localhost:3000',
    'tauri://localhost', 'app://-', 'file://', 'capacitor://localhost', 'noetica://x',
  ]) assert.equal(isLoopbackOrigin(o), true, o)
})

test('external origins are NOT loopback', () => {
  for (const o of [
    'https://evil.com', 'http://attacker.example', 'https://noetica.ai',
    'http://127.0.0.1.evil.com', 'http://localhostx.com', 'https://192.168.1.10', 'not-a-url',
  ]) assert.equal(isLoopbackOrigin(o), false, o)
})

test('OPTIONS (CORS preflight) always passes so the real request can be rejected', () => {
  assert.equal(originAllowed('OPTIONS', 'https://evil.com'), true)
})

test('cross-origin READS are rejected too (drive-by data exfiltration)', () => {
  // A foreign page fetch()ing our loopback GET endpoints would otherwise read the user's graph.
  assert.equal(originAllowed('GET', 'https://evil.com'), false)
  assert.equal(originAllowed('HEAD', 'http://attacker.example'), false)
})

test('reads with no Origin pass (native / CLI / top-level navigation)', () => {
  for (const m of ['GET', 'HEAD', 'get']) assert.equal(originAllowed(m, undefined), true, m)
})

test('reads from a loopback Origin pass (the local UI)', () => {
  assert.equal(originAllowed('GET', 'http://localhost:3000'), true)
  assert.equal(originAllowed('GET', 'tauri://localhost'), true)
})

test('mutating verb with absent Origin passes (native/CLI)', () => {
  assert.equal(originAllowed('POST', undefined), true)
})

test('mutating verb from a loopback Origin passes (the local UI)', () => {
  assert.equal(originAllowed('POST', 'http://localhost:3000'), true)
  assert.equal(originAllowed('POST', 'tauri://localhost'), true)
})

test('mutating verb from a cross-site Origin is REJECTED (the drive-by attack)', () => {
  assert.equal(originAllowed('POST', 'https://evil.com'), false)
  assert.equal(originAllowed('DELETE', 'http://attacker.example'), false)
})

test('no-Origin MUTATING request requires the local token when one is configured', () => {
  process.env['NOETICA_LOCAL_TOKEN'] = 'secret'
  delete process.env['NOETICA_ALLOW_NOORIGIN_WRITES']
  try {
    // Unauthenticated no-Origin write → REJECTED (the any-local-process RCE path).
    assert.equal(originAllowed('POST', undefined, { authenticated: false }), false)
    assert.equal(originAllowed('DELETE', undefined), false)
    // Authenticated no-Origin write → allowed.
    assert.equal(originAllowed('POST', undefined, { authenticated: true }), true)
    // Reads stay open (health/status probes) even with a token configured.
    assert.equal(originAllowed('GET', undefined), true)
    assert.equal(originAllowed('HEAD', undefined), true)
    // The browser UI (loopback Origin) is unaffected — never needs the token.
    assert.equal(originAllowed('POST', 'tauri://localhost'), true)
    // Escape hatch restores legacy behaviour.
    process.env['NOETICA_ALLOW_NOORIGIN_WRITES'] = '1'
    assert.equal(originAllowed('POST', undefined, { authenticated: false }), true)
  } finally {
    delete process.env['NOETICA_LOCAL_TOKEN']
    delete process.env['NOETICA_ALLOW_NOORIGIN_WRITES']
  }
})

test('originAllowed: rejects a hosted origin by default', () => {
  delete process.env['NOETICA_ALLOWED_ORIGINS']
  assert.equal(originAllowed('GET', 'https://app.example.com'), false)
})

test('originAllowed: allows an operator-declared hosted origin', () => {
  process.env['NOETICA_ALLOWED_ORIGINS'] = 'https://app.example.com, https://workspace.example.com'
  try {
    assert.equal(originAllowed('GET', 'https://app.example.com'), true)
    assert.equal(originAllowed('POST', 'https://workspace.example.com/'), true)
    assert.equal(originAllowed('GET', 'https://evil.example.com'), false)
  } finally {
    delete process.env['NOETICA_ALLOWED_ORIGINS']
  }
})
