// Keep the graph in-memory and force the lexical path (dead Ollama hosts → empty
// embeddings, fast) so the test is hermetic and deterministic in CI.
process.env['NODE_ENV'] = 'test'
process.env['OLLAMA_HOST'] = 'http://127.0.0.1:1'
process.env['OLLAMA_FALLBACK_HOST'] = 'http://127.0.0.1:1'

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chunkText, extractText, ingestDocument, semanticSearch, documentChunkCount } from './doc-store.js'

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

test('extractText: plain text passes through; malformed pdf rejects', async () => {
  assert.equal(await extractText('notes.txt', 'text/plain', Buffer.from('hello world')), 'hello world')
  await assert.rejects(() => extractText('paper.pdf', 'application/pdf', Buffer.from('not a real pdf')))
})

test('ingestDocument → semanticSearch round-trips (lexical fallback, no Ollama)', async () => {
  // No Ollama in unit tests → embeddings are empty → semanticSearch uses its
  // lexical fallback. The retrieval must still surface the right chunk.
  const text = 'The Baxter facility shut down after Hurricane Helene caused catastrophic flooding in September 2024. Separately, Texas faced a winter storm.'
  const before = documentChunkCount()
  const r = await ingestDocument('incident.txt', text)
  assert.ok(r.chunks >= 1)
  assert.equal(documentChunkCount(), before + r.chunks)

  const hits = await semanticSearch('What caused the Baxter facility shutdown?', 3)
  assert.ok(hits.length >= 1, 'a chunk was retrieved')
  assert.match(hits[0]!.text, /Baxter|Helene|flood/i)
  assert.equal(hits[0]!.filename, 'incident.txt')
})
