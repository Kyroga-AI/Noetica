/** Tests for the multi-sigil grammar (@ entity, . dot-command, # tag) + Matrix shim. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseSigil, dotToSlash, parseEntityRef, parseTagScope } from './sigils.js'
import { msgTypeFor, toMatrixEvent, HOMESERVER_OPTIONS } from './matrix-shim.js'

test('parseSigil identifies the leading sigil + word + args', () => {
  assert.deepEqual(parseSigil('@model-router show edges'), { sigil: '@', word: 'model-router', args: 'show edges', raw: '@model-router show edges' })
  assert.equal(parseSigil('.help')!.sigil, '.')
  assert.equal(parseSigil('#security threats')!.sigil, '#')
  assert.equal(parseSigil('plain text'), null)
})

test('@entity reference + #tag scope', () => {
  assert.deepEqual(parseEntityRef('@model-router'), { entity: 'model-router', rest: '' })
  assert.equal(parseEntityRef('/not-an-entity'), null)
  assert.deepEqual(parseTagScope('#finance q3'), { topic: 'finance', query: 'q3' })
})

test('.dot-command normalizes to /command', () => {
  assert.equal(dotToSlash('.help'), '/help')
  assert.equal(dotToSlash('/help'), '/help')
})

test('matrix-shim: IRC /me maps to m.emote; system → m.notice; event builder', () => {
  assert.equal(msgTypeFor({ irc: 'me' }), 'm.emote')
  assert.equal(msgTypeFor({ system: true }), 'm.notice')
  assert.equal(msgTypeFor({}), 'm.text')
  const e = toMatrixEvent('hello', { msgtype: 'm.emote', html: '<i>hello</i>' })
  assert.equal(e.type, 'm.room.message')
  assert.equal(e.content.msgtype, 'm.emote')
  assert.equal(e.content.format, 'org.matrix.custom.html')
})

test('Conduit is the recommended lightweight homeserver', () => {
  assert.ok(HOMESERVER_OPTIONS.find((h) => h.name === 'Conduit' && h.lang === 'Rust'))
  assert.ok(HOMESERVER_OPTIONS.find((h) => h.name === 'Synapse')!.why.includes('AVOID'))
})
