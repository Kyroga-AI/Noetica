/** Tests for the per-user identity source — esp. the NEUTRAL default (no developer identity baked in). */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getUserIdentity, isDefaultIdentity, promptUserName, userTwinId, userSubjectId, _resetIdentityCache } from './identity.js'

function withEnv(name: string | undefined, email: string | undefined, fn: () => void): void {
  const on = process.env['NOETICA_USER_NAME'], oe = process.env['NOETICA_USER_EMAIL']
  if (name === undefined) delete process.env['NOETICA_USER_NAME']; else process.env['NOETICA_USER_NAME'] = name
  if (email === undefined) delete process.env['NOETICA_USER_EMAIL']; else process.env['NOETICA_USER_EMAIL'] = email
  _resetIdentityCache()
  try { fn() } finally {
    if (on === undefined) delete process.env['NOETICA_USER_NAME']; else process.env['NOETICA_USER_NAME'] = on
    if (oe === undefined) delete process.env['NOETICA_USER_EMAIL']; else process.env['NOETICA_USER_EMAIL'] = oe
    _resetIdentityCache()
  }
}

test('a fresh identity is NEUTRAL — never the developer', () => {
  withEnv(undefined, undefined, () => {
    // (No ~/.noetica/identity.json is assumed; if one exists on this box it still must not be hardcoded.)
    const id = getUserIdentity()
    assert.notEqual(id.displayName, 'Michael Heller')
    assert.notEqual(id.email, 'michael@socioprophet.ai')
    assert.notEqual(id.slug, 'michael')
  })
})

test('env override sets the identity and a derived slug', () => {
  withEnv('Ada Lovelace', 'ada@example.com', () => {
    const id = getUserIdentity()
    assert.equal(id.displayName, 'Ada Lovelace')
    assert.equal(id.email, 'ada@example.com')
    assert.equal(id.slug, 'ada-lovelace')
    assert.equal(isDefaultIdentity(), false)
    assert.equal(promptUserName(), 'Ada Lovelace')
    assert.equal(userTwinId(), 'urn:gaia:twin:ada-lovelace:0001')
    assert.equal(userSubjectId(), 'urn:gaia:subject:ada-lovelace:0001')
  })
})

test('promptUserName is the neutral "the user" when no real profile is set', () => {
  withEnv(undefined, undefined, () => {
    if (isDefaultIdentity()) assert.equal(promptUserName(), 'the user')
  })
})
