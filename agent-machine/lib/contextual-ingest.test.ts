import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chunkDocument, extractiveSituate, contextualize } from './contextual-ingest.js'

const DOC = `# Overview
intro text about the system.

## Deploy
The deploy step runs make dev-up over kind.

## Scale-Up
Promote to a hyperswarm cluster.`

test('chunkDocument splits with overlap', () => {
  const chunks = chunkDocument('abcdefghij', { size: 4, overlap: 1 })
  assert.ok(chunks.length >= 3)
  assert.equal(chunks[0].text, 'abcd')
})

test('extractiveSituate prepends doc title + nearest heading', async () => {
  const chunk = { id: 'c', text: 'The deploy step runs make dev-up over kind.' }
  const ctx = await extractiveSituate(chunk, { title: 'Continuum', text: DOC })
  assert.match(ctx, /Document: Continuum\./)
  assert.match(ctx, /Section: Deploy\./)
})

test('contextualize prepends the situating context to each chunk', async () => {
  const out = await contextualize(
    [{ id: 'c', text: 'Promote to a hyperswarm cluster.' }],
    { title: 'Continuum', text: DOC },
  )
  assert.match(out[0].context, /Section: Scale-Up\./)
  assert.ok(out[0].contextualized.startsWith(out[0].context))
  assert.ok(out[0].contextualized.endsWith('Promote to a hyperswarm cluster.'))
})

test('an injected situate (e.g. a local-model call) is used', async () => {
  const out = await contextualize(
    [{ id: 'c', text: 'chunk body' }],
    { text: 'doc' },
    () => 'MODEL-SITUATED',
  )
  assert.equal(out[0].context, 'MODEL-SITUATED')
  assert.equal(out[0].contextualized, 'MODEL-SITUATED\nchunk body')
})
