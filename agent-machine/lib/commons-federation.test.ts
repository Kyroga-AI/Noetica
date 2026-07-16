import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { forwardPublish, forwardRevoke, federationEnabled } from './commons-federation.js'

const origFetch = globalThis.fetch
let calls: Array<{ url: string; method: string; headers: Record<string, string>; body?: unknown }>

beforeEach(() => {
  calls = []
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), method: init?.method ?? 'GET', headers: (init?.headers ?? {}) as Record<string, string>, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    return new Response('{"ok":true}', { status: 200 })
  }) as typeof fetch
})
afterEach(() => {
  globalThis.fetch = origFetch
  delete process.env['COMMONS_AGGREGATOR_URL']; delete process.env['COMMONS_PUBLISH_TOKEN']; delete process.env['COMMONS_SOVEREIGN_ID']
})

function configure() {
  process.env['COMMONS_AGGREGATOR_URL'] = 'http://commons.test'
  process.env['COMMONS_PUBLISH_TOKEN'] = 'tok'
  process.env['COMMONS_SOVEREIGN_ID'] = 'alice-pseudo'
}
const tick = () => new Promise((r) => setTimeout(r, 20))

test('federation is OFF unless fully configured', () => {
  assert.equal(federationEnabled(), false)
  process.env['COMMONS_AGGREGATOR_URL'] = 'http://commons.test'   // token + author still missing
  assert.equal(federationEnabled(), false)
})

test('forwardPublish sends the redacted snapshot with token + sovereign-id headers', async () => {
  configure()
  forwardPublish('s1', 'My chat', 'redacted [EMAIL_1] body')
  await tick()
  assert.equal(calls.length, 1)
  const c = calls[0]!
  assert.match(c.url, /\/publish$/)
  assert.equal(c.method, 'POST')
  assert.equal(c.headers['authorization'], 'Bearer tok')
  assert.equal(c.headers['x-sovereign-id'], 'alice-pseudo')
  assert.deepEqual(c.body, { sessionId: 's1', title: 'My chat', redacted: 'redacted [EMAIL_1] body' })
})

test('forwardRevoke issues an author-scoped DELETE', async () => {
  configure()
  forwardRevoke('s1')
  await tick()
  assert.equal(calls.length, 1)
  assert.match(calls[0]!.url, /\/api\/open-chats\/publish\?session=s1$/)
  assert.equal(calls[0]!.method, 'DELETE')
  assert.equal(calls[0]!.headers['authorization'], 'Bearer tok')
})

test('unconfigured forward is a no-op (no fetch)', async () => {
  forwardPublish('s1', 't', 'x')
  forwardRevoke('s1')
  await tick()
  assert.equal(calls.length, 0)
})

test('a failing aggregator never throws into the caller', async () => {
  configure()
  globalThis.fetch = (async () => { throw new Error('network down') }) as typeof fetch
  assert.doesNotThrow(() => forwardPublish('s1', 't', 'x'))
  assert.doesNotThrow(() => forwardRevoke('s1'))
  await tick()   // the async rejection is swallowed inside the module
})
