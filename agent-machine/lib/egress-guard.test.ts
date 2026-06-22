import { test } from 'node:test'
import assert from 'node:assert/strict'
import { shouldBlockEgress, installEgressGuard, setOfflineMode, isOfflineMode, blockedEgressCount } from './egress-guard.js'

test('shouldBlockEgress: offline blocks external hosts, allows local', () => {
  // offline → external blocked
  assert.equal(shouldBlockEgress('https://api.anthropic.com/v1/messages', true), true)
  assert.equal(shouldBlockEgress('https://api.openai.com', true), true)
  assert.equal(shouldBlockEgress('http://93.184.216.34/x', true), true)
  // offline → localhost / sidecars allowed
  assert.equal(shouldBlockEgress('http://127.0.0.1:11435/api/tags', true), false)   // managed Ollama
  assert.equal(shouldBlockEgress('http://localhost:8080/api/status', true), false)  // the AM
  assert.equal(shouldBlockEgress('http://[::1]:7070', true), false)
  // online → nothing blocked
  assert.equal(shouldBlockEgress('https://api.anthropic.com', false), false)
})

test('installEgressGuard physically blocks external fetch when offline', async () => {
  installEgressGuard()
  setOfflineMode(true)
  assert.equal(isOfflineMode(), true)
  const before = blockedEgressCount()

  // External → rejected with EGRESS BLOCKED, no network attempt
  await assert.rejects(() => fetch('https://api.anthropic.com/v1/messages'), /EGRESS BLOCKED/)
  assert.equal(blockedEgressCount(), before + 1)

  // Localhost → allowed through (fails to CONNECT, but NOT egress-blocked — proves it's permitted)
  await assert.rejects(() => fetch('http://127.0.0.1:1/nope'), (e) => !/EGRESS BLOCKED/.test(String(e)))

  setOfflineMode(false) // reset so other suites aren't affected
})

test('online mode passes everything through (guard is a no-op)', () => {
  setOfflineMode(false)
  assert.equal(shouldBlockEgress('https://api.anthropic.com', undefined), false)
})
