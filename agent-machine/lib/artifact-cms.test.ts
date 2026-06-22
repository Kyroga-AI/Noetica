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

test('content-addressing dedups identical content', () => {
  clock = 0
  const c = cms()
  const a = c.create({ type: 'data', title: 'A', content: 'same' })
  c.update(a.id, 'same')
  assert.equal(c.history(a.id)[0]!.hash, c.history(a.id)[1]!.hash, 'identical content → same blob hash')
})
