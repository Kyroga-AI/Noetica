/** Tests for blekko-style /topic chat commands. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseSlashScope, isTopicCommand, withScope, parseIrcCommand } from './slash-commands.js'

test('IRC /me emotes; /shrug; /nick sets name; /roll+/flip deterministic with rng; not topic scopes', () => {
  assert.equal(parseIrcCommand('/me waves at the graph', 'michael')!.reply, '_michael waves at the graph_')
  assert.ok(parseIrcCommand('/shrug')!.reply.includes('¯'))
  const nick = parseIrcCommand('/nick bob', 'michael')!
  assert.equal(nick.setName, 'bob')
  assert.ok(parseIrcCommand('/roll d20', 'x', () => 0)!.reply.includes('**1**'))
  assert.ok(parseIrcCommand('/flip', 'x', () => 0.9)!.reply.includes('tails'))
  assert.equal(parseIrcCommand('/security threats'), null)
  assert.equal(isTopicCommand('/me waves'), false)
})

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
