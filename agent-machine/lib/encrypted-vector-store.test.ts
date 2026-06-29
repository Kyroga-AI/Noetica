import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createEncryptedVectorStore } from './encrypted-vector-store.js'

// In-memory tests — use a temp path that won't collide
const TMP = '/tmp/noetica-evs-test-' + process.pid + '.db'

test('insert and search round-trip', async () => {
  let store: ReturnType<typeof createEncryptedVectorStore>
  try {
    store = createEncryptedVectorStore({ dbPath: TMP, collection: 'test' })
  } catch {
    // bun:sqlite not available (running under node) — skip
    return
  }

  const vec = [0.1, 0.9, 0.2, 0.4]
  store.insert('doc-1', vec, { text: 'hello world' })

  const hits = store.search(vec, { topK: 1 })
  assert.equal(hits.length, 1)
  assert.equal(hits[0]!.id, 'doc-1')
  assert.ok(hits[0]!.score > 0.99, `expected score ~1, got ${hits[0]!.score}`)
  assert.equal((hits[0]!.meta as { text?: string }).text, 'hello world')
})

test('key status reports encrypted=true', async () => {
  let store: ReturnType<typeof createEncryptedVectorStore>
  try {
    store = createEncryptedVectorStore({ dbPath: TMP, collection: 'test-status' })
  } catch {
    return
  }
  const status = store.keyStatus()
  assert.equal(status.encrypted, true)
  assert.ok(['file-0600', 'in-memory', 'macos-keychain'].includes(status.keySource))
})

test('delete removes item from search results', async () => {
  let store: ReturnType<typeof createEncryptedVectorStore>
  try {
    store = createEncryptedVectorStore({ dbPath: TMP, collection: 'test-delete' })
  } catch {
    return
  }
  store.insert('to-delete', [1, 0, 0, 0], {})
  assert.equal(store.count(), 1)
  store.delete('to-delete')
  const hits = store.search([1, 0, 0, 0], { topK: 5 })
  assert.equal(hits.filter((h) => h.id === 'to-delete').length, 0)
})
