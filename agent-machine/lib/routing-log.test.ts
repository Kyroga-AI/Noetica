/** Tests for the opt-in routing-decisions log. */
import { test } from 'node:test'
import assert from 'node:assert/strict'

test('logs nothing unless NOETICA_ROUTING_LOG=1 (privacy default)', async () => {
  delete process.env['NOETICA_ROUTING_LOG']
  const { logRouting, readRoutingLog } = await import('./routing-log.js')
  const before = readRoutingLog().length
  logRouting({ query: 'this should NOT be recorded', intent: 'everyday', domain: 'everyday', effort: 'light' })
  assert.equal(readRoutingLog().length, before) // unchanged
})

test('records intent/domain/effort + a truncated query preview when enabled', async () => {
  process.env['NOETICA_ROUTING_LOG'] = '1'
  const { logRouting, readRoutingLog } = await import('./routing-log.js')
  const longQuery = 'how do i make coffee '.repeat(20) // >120 chars
  logRouting({ query: longQuery, intent: 'everyday', domain: 'everyday', effort: 'light' })
  const last = readRoutingLog(1)[0]!
  assert.equal(last.intent, 'everyday')
  assert.equal(last.domain, 'everyday')
  assert.equal(last.effort, 'light')
  assert.ok(last.query.length <= 120)
  assert.ok(typeof last.ts === 'string')
  delete process.env['NOETICA_ROUTING_LOG']
})
