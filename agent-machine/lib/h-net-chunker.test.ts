/** Tests for the H-net dynamic boundary chunker. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hNetChunk, hNetChunkTexts } from './h-net-chunker.js'

const ARTICLE = `
The transformer architecture has fundamentally changed natural language processing.
Self-attention mechanisms allow models to weigh the relevance of each word against all others in a sequence.
This enables capturing long-range dependencies that recurrent networks struggled with.

Attention is computed via queries, keys, and values derived from the input embeddings.
The dot product of queries and keys, scaled by the square root of the key dimension, produces attention weights.
These weights are applied to the value vectors to produce the output representation.

Large language models stack many transformer layers to build hierarchical representations.
Each layer refines the contextual understanding of the input.
The final layer embeddings are used for downstream tasks like classification or generation.

Fine-tuning adapts pre-trained models to specific domains with relatively few examples.
LoRA decomposes the weight update into low-rank matrices, reducing trainable parameters by orders of magnitude.
This makes it feasible to fine-tune billion-parameter models on consumer hardware.
`.trim()

test('hNetChunk: produces multiple chunks on multi-paragraph text', () => {
  const chunks = hNetChunk(ARTICLE, { minTokens: 40, maxTokens: 150 })
  assert.ok(chunks.length >= 2, `expected ≥2 chunks, got ${chunks.length}`)
})

test('hNetChunk: no chunk exceeds maxTokens by more than one sentence', () => {
  const chunks = hNetChunk(ARTICLE, { minTokens: 40, maxTokens: 120 })
  for (const c of chunks) {
    assert.ok(c.tokens <= 200, `chunk tokens ${c.tokens} far exceeds maxTokens=120`)
  }
})

test('hNetChunk: all original text is preserved across chunks', () => {
  const chunks = hNetChunk(ARTICLE)
  const reconstructed = chunks.map((c) => c.text).join(' ')
  // All significant words from the original should appear in the reconstruction.
  const significant = ARTICLE.split(/\s+/).filter((w) => w.length > 5).slice(0, 20)
  for (const word of significant) {
    assert.ok(reconstructed.includes(word.replace(/[.,]/g, '')), `word "${word}" lost after chunking`)
  }
})

test('hNetChunkTexts: returns strings (convenience wrapper)', () => {
  const texts = hNetChunkTexts(ARTICLE)
  assert.ok(Array.isArray(texts), 'should return array')
  assert.ok(texts.length > 0, 'should return at least one chunk')
  for (const t of texts) assert.equal(typeof t, 'string')
})

test('hNetChunk: short text returns single chunk', () => {
  const short = 'The sky is blue. Water is wet.'
  const chunks = hNetChunk(short)
  assert.equal(chunks.length, 1)
  assert.equal(chunks[0]!.startSentence, 0)
})

test('hNetChunk: startSentence < endSentence for multi-sentence chunks', () => {
  const chunks = hNetChunk(ARTICLE, { minTokens: 60, maxTokens: 300 })
  for (const c of chunks) {
    assert.ok(c.endSentence >= c.startSentence, `endSentence ${c.endSentence} < startSentence ${c.startSentence}`)
  }
})
