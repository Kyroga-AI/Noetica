/** Tests for the slash-command registry / palette. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { matchCommand, formatHelp, COMMANDS } from './command-registry.js'

test('matchCommand resolves names, aliases, and args', () => {
  assert.equal(matchCommand('/help')!.cmd.action.kind, 'help')
  assert.equal(matchCommand('/?')!.cmd.name, 'help', 'alias ?')
  const rag = matchCommand('/rag model router')!
  assert.equal((rag.cmd.action as { surface: string }).surface, 'rag')
  assert.equal(rag.args, 'model router')
  assert.equal(matchCommand('/g')!.cmd.name, 'graph', 'alias g')
  assert.equal(matchCommand('/cap')!.cmd.name, 'lab', 'alias cap → lab')
})

test('unregistered slash words are not commands (→ fall through to topic scope)', () => {
  assert.equal(matchCommand('/security threats'), null)
  assert.equal(matchCommand('/sports'), null)
})

test('mcp/data are registered as coming-soon', () => {
  assert.equal(matchCommand('/mcp')!.cmd.action.kind, 'soon')
  assert.equal(matchCommand('/data sales')!.cmd.action.kind, 'soon')
})

test('formatHelp lists categories + every command', () => {
  const h = formatHelp()
  assert.ok(h.includes('Navigate') && h.includes('Data') && h.includes('Model') && h.includes('Tools'))
  for (const c of COMMANDS) assert.ok(h.includes(c.hint), `help mentions ${c.name}`)
})
