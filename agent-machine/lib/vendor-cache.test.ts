import { test } from 'node:test'
import assert from 'node:assert/strict'
import { materialize, gc, enforceBudget, type VendorHandle } from './vendor-cache.js'

test('egress gate: a secret cannot be materialized to a cloud vendor', () => {
  const r = materialize({ contentId: 'c1', vendor: 'claude', labels: ['secret'], content: 'the deploy key' })
  assert.equal(r.ok, false)
  assert.match(r.reason, /egress denied/)
})

test('public content materializes; Gemini gets a TTL, Claude is durable', () => {
  const g = materialize({ contentId: 'c2', vendor: 'gemini', labels: ['public'], content: 'press release', now: 1000 })
  assert.equal(g.ok, true)
  assert.equal(g.handle!.expiresAt, 1000 + 48 * 3600_000) // 48h TTL
  const c = materialize({ contentId: 'c3', vendor: 'claude', labels: ['public'], now: 1000 })
  assert.equal(c.ok, true)
  assert.equal(c.handle!.expiresAt, undefined) // durable — no expiry
})

test('GC expires TTL handles past expiry; durable survives', () => {
  const handles: VendorHandle[] = [
    { id: 'a', vendor: 'gemini', fileId: 'f', contentId: 'c', createdAt: 0, expiresAt: 100, state: 'active' },
    { id: 'b', vendor: 'claude', fileId: 'f', contentId: 'c', createdAt: 0, state: 'active' },
  ]
  const { kept, expired } = gc(handles, 200)
  assert.equal(expired.length, 1)
  assert.equal(expired[0].id, 'a')
  assert.equal(expired[0].state, 'expired')
  assert.equal(kept.length, 1)
  assert.equal(kept[0].id, 'b')
})

test('budget evicts the oldest handles per vendor', () => {
  const handles: VendorHandle[] = [0, 1, 2].map((t) => ({ id: `h${t}`, vendor: 'openai', fileId: 'f', contentId: `c${t}`, createdAt: t, state: 'active' }))
  const { kept, evicted } = enforceBudget(handles, 2)
  assert.equal(kept.length, 2)
  assert.equal(evicted.length, 1)
  assert.equal(evicted[0].id, 'h0') // oldest evicted
})
