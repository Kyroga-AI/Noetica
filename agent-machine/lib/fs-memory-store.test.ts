import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fsMemoryStore } from './fs-memory-store.js'
import { manualWrite, extractMemory, autoDream, assembleContext, type TopicDoc } from './memory-layers.js'

let dir: string
const doc = (name: string, body: string, extra: Partial<TopicDoc> = {}): TopicDoc =>
  ({ name, body, links: [], updatedAt: 0, ...extra })

before(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'noetica-mem-'))
  process.env.NOETICA_MEMORY_DIR = dir
})
after(async () => { await fs.rm(dir, { recursive: true, force: true }) })

test('topic round-trips through .md frontmatter (links/score/provenance)', async () => {
  const s = fsMemoryStore()
  await s.writeTopic(doc('auth', 'Auth uses JWT.', { links: ['session'], score: 3, provenance: 'design', updatedAt: 5 }))
  const back = await s.readTopic('auth')
  assert.equal(back?.name, 'auth')
  assert.equal(back?.body.trim(), 'Auth uses JWT.')
  assert.deepEqual(back?.links, ['session'])
  assert.equal(back?.score, 3)
  assert.equal(back?.provenance, 'design')
})

test('body [[wikilinks]] are parsed as backlinks (living-KB)', async () => {
  const s = fsMemoryStore()
  await s.writeTopic(doc('deploy', 'Deploy via [[continuum]] and [[porter]].', { links: ['workstation'] }))
  const back = await s.readTopic('deploy')
  assert.deepEqual(new Set(back?.links), new Set(['workstation', 'continuum', 'porter']))
})

test('manualWrite persists topic + syncs MEMORY.md index on disk', async () => {
  const s = fsMemoryStore()
  await manualWrite(s, doc('tritrpc', 'TriRPC envelope: header/sender/error.'))
  const memmd = await fs.readFile(path.join(dir, 'MEMORY.md'), 'utf8')
  assert.match(memmd, /# Memory Index/)
  assert.match(memmd, /- \[tritrpc\]\(tritrpc\) — TriRPC envelope/)
})

test('autoDream prunes + persists; a fresh store sees the survivors', async () => {
  const s = fsMemoryStore()
  await extractMemory(s, doc('keep', 'salient', { score: 5 }))
  await extractMemory(s, doc('drop', 'noise', { score: 0 }))
  const rep = await autoDream(s)
  assert.equal(rep.pruned, 1)
  const fresh = fsMemoryStore()               // re-open from disk
  assert.ok(await fresh.readTopic('keep'))
  assert.equal(await fresh.readTopic('drop'), null)
  assert.match(await assembleContext(fresh), /\[keep\]/)
})

test('transcripts are append-only + grep-only', async () => {
  const s = fsMemoryStore()
  await extractMemory(s, doc('x', 'graph ops note'))
  assert.equal((await s.grepTranscripts('graph ops')).length, 1)
  assert.equal((await s.grepTranscripts('absent')).length, 0)
})
