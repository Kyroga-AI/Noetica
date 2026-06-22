/** Tests for the artifact CMS — versioning, content-addressing, rollback, search, drive bridge. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ArtifactCMS, type ContentStore } from './artifact-cms.js'

function memStore(): ContentStore {
  const m = new Map<string, string>()
  let n = 0
  return {
    put: (data) => { const hash = `h${[...m].find(([, v]) => v === data)?.[0]?.slice(1) ?? n++}`; m.set(hash, data); return { hash, size: data.length } },
    get: (hash) => m.get(hash) ?? null,
  }
}
let clock = 0
const cms = () => new ArtifactCMS(memStore(), () => `t${clock++}`)

test('create + get content', () => {
  clock = 0
  const c = cms()
  const a = c.create({ type: 'document', title: 'Design Doc', content: '# v1', tags: ['design'] })
  assert.equal(a.currentVersion, 1)
  assert.equal(c.getContent(a.id), '# v1')
  assert.deepEqual(a.tags, ['design'])
})

test('update creates a new version; history + old versions retrievable', () => {
  clock = 0
  const c = cms()
  const a = c.create({ type: 'document', title: 'Doc', content: 'v1' })
  c.update(a.id, 'v2', 'second draft')
  c.update(a.id, 'v3')
  assert.equal(c.get(a.id)!.currentVersion, 3)
  assert.equal(c.getContent(a.id), 'v3', 'current is latest')
  assert.equal(c.getContent(a.id, 1), 'v1', 'old version still retrievable')
  assert.equal(c.history(a.id).length, 3)
  assert.equal(c.history(a.id)[1]!.message, 'second draft')
})

test('rollback restores an old version as a new version (non-destructive)', () => {
  clock = 0
  const c = cms()
  const a = c.create({ type: 'code', title: 'X', content: 'good' })
  c.update(a.id, 'broken')
  const r = c.rollback(a.id, 1)
  assert.equal(r!.currentVersion, 3, 'rollback is a new version, not a deletion')
  assert.equal(c.getContent(a.id), 'good')
})

test('list/search/filter + delete', () => {
  clock = 0
  const c = cms()
  c.create({ type: 'document', title: 'Auth Spec', content: 'a', tags: ['security'] })
  const code = c.create({ type: 'code', title: 'parser', content: 'b' })
  assert.equal(c.list({ type: 'code' }).length, 1)
  assert.equal(c.list({ tag: 'security' }).length, 1)
  assert.equal(c.search('auth').length, 1)
  assert.equal(c.delete(code.id), true)
  assert.equal(c.list().length, 1)
})

test('drive bridge: artifact → workspace file with type-appropriate name', () => {
  clock = 0
  const c = cms()
  const a = c.create({ type: 'document', title: 'My Notes!', content: '# notes' })
  const f = c.driveFile(a.id)!
  assert.equal(f.path, 'my-notes.md')
  assert.equal(f.content, '# notes')
})

test('content-addressing: identical update is a no-op (no version bloat)', () => {
  clock = 0
  const c = cms()
  const a = c.create({ type: 'data', title: 'A', content: 'same' })
  c.update(a.id, 'same'); c.update(a.id, 'same')
  assert.equal(c.get(a.id)!.currentVersion, 1, 'identical content adds no version')
  assert.equal(c.history(a.id).length, 1)
  c.update(a.id, 'different')
  assert.equal(c.get(a.id)!.currentVersion, 2, 'changed content does add a version')
})

test('HARDENING: reload derives seq from max id suffix → no collision/overwrite after deletions', () => {
  clock = 0
  const store = memStore()
  const c1 = new ArtifactCMS(store, () => `t${clock++}`)
  const a = c1.create({ type: 'document', title: 'Doc', content: 'a' })   // art-doc-0
  c1.create({ type: 'document', title: 'Doc', content: 'b' })             // art-doc-1
  c1.delete(a.id)                                                          // snapshot now has 1 item
  const snap = c1.snapshot()
  const c2 = new ArtifactCMS(store, () => `t${clock++}`)
  c2.hydrate(snap)
  const fresh = c2.create({ type: 'document', title: 'Doc', content: 'c' })
  assert.notEqual(fresh.id, 'art-doc-1', 'must NOT collide with the surviving art-doc-1')
  assert.equal(c2.get('art-doc-1') !== null, true, 'surviving artifact intact, not overwritten')
})

test('HARDENING: hydrate rejects malformed/non-array input without throwing', () => {
  const c = cms()
  c.hydrate(null as unknown)
  c.hydrate([{ bogus: true }, null, 'str'] as unknown)
  assert.equal(c.list().length, 0, 'garbage entries skipped, no crash')
})
