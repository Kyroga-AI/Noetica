import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  inMemoryStore, manualWrite, extractMemory, autoDream, assembleContext, recallTopic, grepMemory,
  defaultDistill, type TopicDoc,
} from './memory-layers.js'

const doc = (name: string, body: string, extra: Partial<TopicDoc> = {}): TopicDoc =>
  ({ name, body, links: [], updatedAt: 0, ...extra })

test('L1 index is assembled from pointers, not content', async () => {
  const s = inMemoryStore()
  await manualWrite(s, doc('auth', 'Auth uses JWT.\nmore detail', { links: ['session'] }))
  const ctx = await assembleContext(s)
  assert.match(ctx, /- \[auth\]\(auth\) — Auth uses JWT\./)
  assert.doesNotMatch(ctx, /more detail/) // index holds the hook, not the body
})

test('L2 topics load on demand; L3 transcripts are grep-only', async () => {
  const s = inMemoryStore()
  await extractMemory(s, doc('deploy', 'Deploy via continuum make dev-up'))
  assert.equal((await recallTopic(s, 'deploy'))?.body, 'Deploy via continuum make dev-up')
  assert.deepEqual(await grepMemory(s, 'deploy'), ['extracted deploy: Deploy via continuum make dev-up'])
  assert.deepEqual(await grepMemory(s, 'nonesuch'), [])
})

test('Phase 2 defaultDistill merges duplicates + unions backlinks (keeps max score)', () => {
  const merged = defaultDistill([
    doc('tritrpc', 'envelope v1', { links: ['a'], score: 1 }),
    doc('tritrpc', 'envelope v1', { links: ['b'], score: 2 }),
  ])
  assert.equal(merged.length, 1)
  assert.deepEqual(new Set(merged[0]!.links), new Set(['a', 'b']))
  assert.equal(merged[0]!.score, 2)
})

test('autoDream commits the distilled set + syncs the index', async () => {
  const s = inMemoryStore()
  await extractMemory(s, doc('tritrpc', 'envelope v1', { links: ['a'], score: 1 }))
  const rep = await autoDream(s) // default distill is a no-op on a single unique topic
  assert.equal(rep.forked, 1)
  assert.equal(rep.indexed, 1)
  assert.match(await assembleContext(s), /\[tritrpc\]/)
})

test('autoDream Phase 4 prunes low-value memories (entropy control)', async () => {
  const s = inMemoryStore()
  await extractMemory(s, doc('keep', 'salient', { score: 5 }))
  await extractMemory(s, doc('drop', 'derivable noise', { score: 0 }))
  const rep = await autoDream(s)
  assert.equal(rep.pruned, 1)
  assert.equal(rep.indexed, 1)
  assert.ok(await recallTopic(s, 'keep'))
  assert.equal(await recallTopic(s, 'drop'), null)
})

test('autoDream Phase 3 resolves conflicts by score', async () => {
  const s = inMemoryStore()
  await extractMemory(s, doc('port', 'gitea on 3000', { score: 1 }))
  await extractMemory(s, doc('port2', 'gitea on 3001', { score: 3 }))
  const rep = await autoDream(s, { findConflicts: () => [['port', 'port2']] })
  assert.equal(rep.conflicts, 1)
  assert.equal(rep.indexed, 1) // the two conflicting topics collapse to the winner
  const survivors = await Promise.all(['port', 'port2'].map((n) => recallTopic(s, n)))
  assert.equal(survivors.filter(Boolean).length, 1)
})

test('consolidationLock serializes dreams (no interleave)', async () => {
  const s = inMemoryStore()
  await extractMemory(s, doc('x', 'x', { score: 1 }))
  const [a, b] = await Promise.all([autoDream(s), autoDream(s)])
  assert.equal(a.indexed, 1)
  assert.equal(b.indexed, 1) // second ran after the first committed, not on a half-mutated store
})
