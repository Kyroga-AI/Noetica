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
