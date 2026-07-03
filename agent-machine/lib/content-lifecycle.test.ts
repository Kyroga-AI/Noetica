import { test } from 'node:test'
import assert from 'node:assert/strict'
import { transition, advanceToServed, type ContentItem, type AuditEvent } from './content-lifecycle.js'

const item = (over: Partial<ContentItem> = {}): ContentItem =>
  ({ id: 'c1', state: 'IngestedRaw', container: { workspace_id: 'w', thread_id: 't' }, createdAt: 0, ...over })

test('happy path Ingested → Served advances through every layer, audited', () => {
  const events: AuditEvent[] = []
  const r = advanceToServed(item(), { audit: (e) => events.push(e) })
  assert.equal(r.ok, true)
  assert.equal(r.item.state, 'Served')
  assert.deepEqual(events.filter((e) => e.ok).map((e) => e.to), ['Normalized', 'Extracted', 'Indexed', 'Served'])
})

test('illegal transitions are refused (no skipping layers)', () => {
  assert.equal(transition(item(), 'Served').ok, false)          // IngestedRaw → Served (skips)
  assert.equal(transition(item({ state: 'Deleted' }), 'Served').ok, false) // Deleted is terminal
})

test('a legal hold blocks deletion', () => {
  const served = item({ state: 'Served', legalHold: true })
  const r = transition(served, 'Deleted')
  assert.equal(r.ok, false)
  assert.match(r.reason, /legal hold/)
  // but once moved to LegalHold and released, deletion is allowed
  assert.equal(transition(item({ state: 'LegalHold', legalHold: true }), 'Deleted').ok, true)
})

test('egress gate: sensitive content cannot be vendor-materialized to a cloud API', () => {
  const secret = item({ state: 'Served', labels: ['secret'], content: 'the deploy key' })
  const r = transition(secret, 'VendorMaterialized')
  assert.equal(r.ok, false)
  assert.match(r.reason, /egress denied/)
})

test('egress gate: public content may be vendor-materialized', () => {
  const pub = item({ state: 'Served', labels: ['public'], content: 'press release' })
  assert.equal(transition(pub, 'VendorMaterialized').ok, true)
})

test('retention: Served → Deleted allowed when no hold', () => {
  assert.equal(transition(item({ state: 'Served' }), 'Deleted').ok, true)
})
