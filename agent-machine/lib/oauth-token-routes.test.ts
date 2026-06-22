/** Tests for the OAuth token-exchange builder — esp. that the Notion client_secret never round-trips. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildOAuthExchange } from './oauth-token-routes.js'

test('notion: client_secret is stripped from the body and carried only in Basic auth', () => {
  const p = new URLSearchParams({ client_id: 'cid', client_secret: 'sshh-secret', code: 'abc', grant_type: 'authorization_code' })
  const ex = buildOAuthExchange('notion', p)
  assert.ok(ex)
  // the secret must NOT appear in the forwarded body
  assert.ok(!ex!.init.body.includes('sshh-secret'), 'secret leaked into body')
  // it must be present in the Authorization: Basic header (client_id:client_secret)
  const auth = ex!.init.headers['Authorization'] ?? ''
  assert.ok(auth.startsWith('Basic '))
  assert.ok(Buffer.from(auth.slice(6), 'base64').toString() === 'cid:sshh-secret')
  // the non-secret fields are still forwarded
  assert.ok(ex!.init.body.includes('abc'))
})

test('form providers (github) post form-encoded params', () => {
  const ex = buildOAuthExchange('github', new URLSearchParams({ client_secret: 's', code: 'c' }))
  assert.ok(ex)
  assert.match(ex!.init.headers['Content-Type'] ?? '', /form-urlencoded/)
  assert.equal(ex!.init.headers['Accept'], 'application/json')
})

test('unknown provider → null', () => {
  assert.equal(buildOAuthExchange('evilcorp', new URLSearchParams()), null)
})
