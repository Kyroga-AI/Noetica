import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import * as os from 'node:os'
import * as fs from 'node:fs'
import * as path from 'node:path'

import { publishOpenChat, revokeOpenChat, isOpen, listOpenChats, searchOpenChats } from './open-chat-index.js'

// Isolate the store to a temp HOME so we never touch the real ~/.noetica. The index loads lazily (first publish),
// so setting HOME in before() — which runs ahead of every test — is sufficient.
before(() => { process.env['HOME'] = fs.mkdtempSync(path.join(os.tmpdir(), 'noetica-openchat-')) })

test('publish stores ONLY redacted content — raw PII never enters the index', () => {
  const r = publishOpenChat('sess-1', 'Tax question', [
    { role: 'user', content: 'my SSN is 123-45-6789 and email bob@example.com' },
    { role: 'assistant', content: 'noted' },
  ])
  assert.equal(r.ok, true)
  assert.ok(r.findings!.piiCount >= 2)
  const entry = listOpenChats().find((e) => e.sessionId === 'sess-1')!
  assert.ok(entry, 'entry not stored')
  assert.ok(!entry.redacted.includes('123-45-6789'), 'raw SSN in index')
  assert.ok(!entry.redacted.includes('bob@example.com'), 'raw email in index')
  // and no reversal mapping is persisted anywhere on the entry
  assert.equal('mapping' in (entry as unknown as Record<string, unknown>), false)
})

test('search returns redacted snippets, never raw PII', () => {
  publishOpenChat('sess-2', 'Paris trip', [{ role: 'user', content: 'planning a trip to Paris, call me 415-555-0199' }])
  const hits = searchOpenChats('paris trip')
  assert.ok(hits.length >= 1, 'no hits')
  assert.ok(hits.every((h) => !h.snippet.includes('415-555-0199')), 'raw phone in snippet')
})

test('revoke is immediate — the entry is gone at once', () => {
  publishOpenChat('sess-3', 'Temp', [{ role: 'user', content: 'hello world foobar' }])
  assert.equal(isOpen('sess-3'), true)
  const r = revokeOpenChat('sess-3')
  assert.equal(r.removed, true)
  assert.equal(isOpen('sess-3'), false)
  assert.equal(searchOpenChats('foobar').some((h) => h.sessionId === 'sess-3'), false, 'revoked chat still searchable')
})

test('ephemeral (security-lane) chats can NEVER be opened', () => {
  const r = publishOpenChat('sess-eph', 'Armed', [{ role: 'user', content: 'sensitive' }], { ephemeral: true })
  assert.equal(r.ok, false)
  assert.match(r.error!, /ephemeral/)
  assert.equal(isOpen('sess-eph'), false)
})

test('publish fails CLOSED when the gate cannot run', () => {
  const hostile = [{ role: 'user', get content(): string { throw new Error('boom') } }] as unknown as Parameters<typeof publishOpenChat>[2]
  const r = publishOpenChat('sess-bad', 'X', hostile)
  assert.equal(r.ok, false)
  assert.equal(isOpen('sess-bad'), false, 'indexed despite gate failure')
})

test('proto-pollution sessionId cannot reach Object.prototype', () => {
  publishOpenChat('__proto__', 'evil', [{ role: 'user', content: 'x' }])
  assert.equal(({} as Record<string, unknown>)['polluted'], undefined)
  assert.equal(Object.prototype.hasOwnProperty.call({}, '__proto__'), false)
})
