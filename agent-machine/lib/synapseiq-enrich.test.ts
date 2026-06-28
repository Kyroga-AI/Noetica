import { test } from 'node:test'
import assert from 'node:assert/strict'
import { synapseEnrich, fallbackSymbols, enrichmentToTriples, type SynapseTransport } from './synapseiq-enrich.js'

test('fallback extracts code definitions across langs', async () => {
  const py = 'def solve(x):\n  return x\nclass Solver:\n  pass'
  const e = await synapseEnrich(py, { filename: 'a.py' })
  assert.equal(e.source, 'fallback')
  assert.equal(e.lang, 'python')
  assert.ok(e.entities.includes('solve'))
  assert.ok(e.entities.includes('Solver'))
  assert.equal(e.kinds['function'], 1)
  assert.equal(e.kinds['class'], 1)
})

test('fallback extracts TS exports + interfaces + markdown headings', async () => {
  const ts = 'export function foo(){}\nexport interface Bar {}\nexport const baz = 1'
  const e = await synapseEnrich(ts, { filename: 'x.ts' })
  assert.ok(e.entities.includes('foo') && e.entities.includes('Bar') && e.entities.includes('baz'))
  const md = await synapseEnrich('# Title\n## Section\ntext', { filename: 'n.md' })
  assert.ok(md.entities.includes('Title') && md.entities.includes('Section'))
  assert.equal(md.kinds['heading'], 2)
})

test('SynapseIQ transport result is preferred when it returns symbols', async () => {
  const transport: SynapseTransport = async () => ({ lang: 'rust', symbols: [{ name: 'main', kind: 'function' }, { name: 'Config', kind: 'struct' }] })
  const e = await synapseEnrich('fn whatever(){}', { filename: 'm.rs' }, transport)
  assert.equal(e.source, 'synapseiq')
  assert.equal(e.lang, 'rust')
  assert.deepEqual(e.entities, ['main', 'Config'])
  assert.equal(e.kinds['struct'], 1)
})

test('transport failure falls back deterministically (never throws)', async () => {
  const broken: SynapseTransport = async () => { throw new Error('synapseiq down') }
  const e = await synapseEnrich('def x():\n pass', { filename: 'a.py' }, broken)
  assert.equal(e.source, 'fallback')
  assert.ok(e.entities.includes('x'))
})

test('transport returning null/empty falls back', async () => {
  const empty: SynapseTransport = async () => null
  const e = await synapseEnrich('class Z {}', { filename: 'z.ts' }, empty)
  assert.equal(e.source, 'fallback')
  assert.ok(e.entities.includes('Z'))
})

test('enrichmentToTriples: asset contains symbol; symbol is_a kind', () => {
  const e = { lang: 'python', symbols: [{ name: 'solve', kind: 'function' }], entities: ['solve'], kinds: { function: 1 }, source: 'fallback' as const }
  const t = enrichmentToTriples('asset:vehicles.csv', e)
  assert.deepEqual(t, [
    { subject: 'asset:vehicles.csv', predicate: 'contains', object: 'solve' },
    { subject: 'solve', predicate: 'is_a', object: 'function' },
  ])
})

test('symbols dedupe and cap; no symbols → empty enrichment', async () => {
  const dup = 'def a():\n pass\ndef a():\n pass'
  assert.equal(fallbackSymbols(dup).symbols.length, 1)
  assert.deepEqual((await synapseEnrich('plain prose with no defs', {})).entities, [])
})
