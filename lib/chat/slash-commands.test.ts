/** Tests for blekko-style /topic chat commands. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseSlashScope, isTopicCommand, withScope } from './slash-commands.js'

test('parses /topic with a query', () => {
  const p = parseSlashScope('/security latest auth changes')
  assert.equal(p!.topic, 'security')
  assert.equal(p!.query, 'latest auth changes')
  assert.equal(p!.clear, false)
})

test('bare /topic sets a persistent scope', () => {
  assert.deepEqual(parseSlashScope('/finance'), { topic: 'finance', query: '', clear: false })
})

test('/all and /clear reset the scope', () => {
  assert.equal(parseSlashScope('/all')!.clear, true)
  assert.equal(parseSlashScope('/clear')!.clear, true)
})

test('reserved app commands are not topic scopes', () => {
  assert.equal(isTopicCommand('/settings'), false)
  assert.equal(isTopicCommand('/help'), false)
  assert.equal(isTopicCommand('/security threats'), true)
})

test('non-slash input is not a command', () => {
  assert.equal(parseSlashScope('hello there'), null)
  assert.equal(isTopicCommand('what is 2+2'), false)
})

test('withScope: command sets scope; plain query inherits active scope; /all clears', () => {
  assert.deepEqual(withScope('/security auth', null), { topic: 'security', query: 'auth' })
  assert.deepEqual(withScope('show me more', 'security'), { topic: 'security', query: 'show me more' })
  assert.deepEqual(withScope('/all', 'security'), { topic: null, query: '' })
})
