import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extractJson, generateBriefing, generateStudyGuide, generateAudioScript, type Generate, type CanonLookup } from './study-outputs.js'

test('extractJson handles fenced and prose-wrapped JSON', () => {
  assert.deepEqual(extractJson('```json\n{"a":1}\n```'), { a: 1 })
  assert.deepEqual(extractJson('sure, here:\n[{"x":2}]\nhope that helps'), [{ x: 2 }])
  assert.equal(extractJson('no json here'), null)
})

test('generateBriefing parses themes/facts/quotes/summary', async () => {
  const gen: Generate = async () => JSON.stringify({ themes: ['t1', 't2'], keyFacts: ['f1'], quotes: ['"q"'], summary: 'sum' })
  const b = await generateBriefing(['source text'], gen)
  assert.deepEqual(b.themes, ['t1', 't2'])
  assert.equal(b.summary, 'sum')
  assert.equal(b.keyFacts.length, 1)
})

test('generateBriefing degrades gracefully on unparseable output', async () => {
  const gen: Generate = async () => 'the model rambled with no json'
  const b = await generateBriefing(['s'], gen)
  assert.deepEqual(b, { themes: [], keyFacts: [], quotes: [], summary: '' })
})

test('study guide definitions PREFER the frontier-authored canon over the model', async () => {
  const gen: Generate = async () => JSON.stringify({
    definitions: [{ term: 'eigenvalue', definition: 'MODEL-WRITTEN def (should be overridden)' }, { term: 'foobar', definition: 'model def kept' }],
    shortAnswer: ['q1', 'q2'], essayQuestions: ['e1'],
    glossary: [{ term: 'eigenvalue', gloss: 'model gloss' }],
  })
  const canon: CanonLookup = (t) => (t === 'eigenvalue' ? 'CANON: a scalar λ with Av = λv' : null)
  const g = await generateStudyGuide(['linear algebra source'], gen, canon)

  const eig = g.definitions.find((d) => d.term === 'eigenvalue')!
  assert.equal(eig.source, 'canon', 'canon-covered term uses the authored definition')
  assert.match(eig.definition, /CANON/)
  const foo = g.definitions.find((d) => d.term === 'foobar')!
  assert.equal(foo.source, 'model', 'non-canon term falls back to the model def')
  assert.equal(g.glossary.find((x) => x.term === 'eigenvalue')!.source, 'canon', 'glossary is canon-grounded too')
  assert.equal(g.shortAnswer.length, 2)
})

test('study guide works without a canon lookup (all model-sourced)', async () => {
  const gen: Generate = async () => JSON.stringify({ definitions: [{ term: 'x', definition: 'd' }], shortAnswer: [], essayQuestions: [], glossary: [] })
  const g = await generateStudyGuide(['s'], gen)
  assert.equal(g.definitions[0]!.source, 'model')
})

test('generateAudioScript yields a two-host dialogue, normalizing speakers', async () => {
  const gen: Generate = async () => JSON.stringify([
    { speaker: 'Host', line: 'Welcome.' },
    { speaker: 'Guest', line: 'Glad to be here.' },
    { speaker: 'Narrator', line: 'this odd speaker maps to Host' },
    { speaker: 'Host', line: '' },          // empty line dropped
  ])
  const script = await generateAudioScript(['s'], gen, 'debate')
  assert.equal(script.length, 3, 'empty-line turn dropped')
  assert.equal(script[0]!.speaker, 'Host')
  assert.equal(script[1]!.speaker, 'Guest')
  assert.equal(script[2]!.speaker, 'Host', 'unknown speaker normalized to Host')
})
