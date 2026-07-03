import { test } from 'node:test'
import assert from 'node:assert/strict'
import { scheduleRetention } from './retention-scheduler.js'
import type { ContentItem } from './content-lifecycle.js'

const item = (over: Partial<ContentItem>): ContentItem =>
  ({ id: 'c', state: 'Served', container: {}, createdAt: 0, ...over })

test('items within TTL are kept; expired ones are deleted', () => {
  const items = [item({ id: 'young', createdAt: 900 }), item({ id: 'old', createdAt: 0 })]
  const { actions, deleted } = scheduleRetention(items, { ttlMs: 500 }, { now: 1000 })
  assert.equal(actions.find((a) => a.itemId === 'young')!.action, 'keep')
  assert.equal(actions.find((a) => a.itemId === 'old')!.action, 'delete')
  assert.deepEqual(deleted.map((d) => d.id), ['old'])
})

test('a legal hold blocks retention deletion (held, not deleted)', () => {
  const { actions, deleted } = scheduleRetention([item({ id: 'held', createdAt: 0, legalHold: true })], { ttlMs: 500 }, { now: 1000 })
  assert.equal(actions[0].action, 'held')
  assert.match(actions[0].reason, /legal hold/)
  assert.equal(deleted.length, 0)
})

test('retention actions are audited', () => {
  const events: Array<{ to: string; ok: boolean }> = []
  scheduleRetention([item({ id: 'old', createdAt: 0 })], { ttlMs: 1 }, { now: 100, audit: (e) => events.push({ to: e.to, ok: e.ok }) })
  assert.ok(events.some((e) => e.to === 'Deleted' && e.ok))
})

test('no TTL policy keeps everything', () => {
  const { deleted } = scheduleRetention([item({ createdAt: 0 })], {}, { now: 1e12 })
  assert.equal(deleted.length, 0)
})
