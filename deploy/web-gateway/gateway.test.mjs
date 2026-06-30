/** Tests for the web-gateway routing logic (pure functions only — no socket bind). */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { shouldProxy, resolveStaticPath } from './gateway.mjs'

test('shouldProxy: API + health route to the sidecar', () => {
  assert.equal(shouldProxy('/api/chat'), true)
  assert.equal(shouldProxy('/api/graph/analytics'), true)
  assert.equal(shouldProxy('/api'), true)
  assert.equal(shouldProxy('/health'), true)
})

test('shouldProxy: static assets are served locally, not proxied', () => {
  assert.equal(shouldProxy('/'), false)
  assert.equal(shouldProxy('/index.html'), false)
  assert.equal(shouldProxy('/_next/static/chunk.js'), false)
  assert.equal(shouldProxy('/workspace'), false)
  assert.equal(shouldProxy('/apiculture'), false) // not /api or /api/*
})

test('resolveStaticPath: confines to the static dir', () => {
  const dir = '/srv/out'
  assert.equal(resolveStaticPath('/index.html', dir), '/srv/out/index.html')
  assert.equal(resolveStaticPath('/_next/static/a.js', dir), '/srv/out/_next/static/a.js')
})

test('resolveStaticPath: blocks path traversal', () => {
  const dir = '/srv/out'
  // ../ escapes are stripped/confined — never resolves outside the static dir.
  const r1 = resolveStaticPath('/../../etc/passwd', dir)
  assert.ok(r1 === null || r1.startsWith('/srv/out'), `traversal escaped: ${r1}`)
  const r2 = resolveStaticPath('/%2e%2e/%2e%2e/etc/passwd', dir)
  assert.ok(r2 === null || r2.startsWith('/srv/out'), `encoded traversal escaped: ${r2}`)
})

test('resolveStaticPath: handles encoded spaces', () => {
  const dir = '/srv/out'
  assert.equal(resolveStaticPath('/my%20file.txt', dir), '/srv/out/my file.txt')
})
