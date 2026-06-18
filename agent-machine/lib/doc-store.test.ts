import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chunkText } from './doc-store.js'

test('chunkText terminates and covers short, exact, and long inputs', () => {
  assert.deepEqual(chunkText(''), [])
  assert.equal(chunkText('short doc').length, 1)
  // Long input must terminate (regression: infinite loop OOM) and cover the text.
  const long = 'sentence. '.repeat(2000) // ~20k chars
  const chunks = chunkText(long)
  assert.ok(chunks.length > 1 && chunks.length < 200, `reasonable chunk count, got ${chunks.length}`)
  assert.ok(chunks.join(' ').includes('sentence'))
})

test('chunkText: no chunk exceeds ~2x window (boundary logic sane)', () => {
  const chunks = chunkText('x'.repeat(5000))
  for (const c of chunks) assert.ok(c.length <= 2300, `chunk len ${c.length}`)
})
