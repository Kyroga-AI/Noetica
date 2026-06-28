import { test } from 'node:test'
import assert from 'node:assert/strict'
import { citeMatch, bestSource, citationCoverage, contentTokens, type CiteSource } from './cite-match.js'

const SOURCES: CiteSource[] = [
  { n: 1, text: 'The water report found that lead concentrations exceeded the federal action level in several samples.' },
  { n: 2, text: 'Roughly eighty percent of the plants surveyed rely on municipal tap water for irrigation during summer.' },
  { n: 3, text: 'Mitigation options include reverse osmosis filtration and switching to rainwater collection systems.' },
]

test('adds a [n] marker to a grounded sentence the model left uncited', () => {
  const ans = 'About eighty percent of the surveyed plants rely on municipal tap water for irrigation.'
  const out = citeMatch(ans, SOURCES)
  assert.match(out, /\[2\]\.?$/)   // matched to source 2
})

test('idempotent: a sentence already carrying its marker is untouched', () => {
  const ans = 'About eighty percent of plants rely on municipal tap water for irrigation [2].'
  assert.equal(citeMatch(ans, SOURCES), ans)
})

test('non-fabricating: a sentence no source supports gets no marker', () => {
  const ans = 'The capital of France is Paris and the Eiffel Tower is a popular landmark.'
  assert.equal(citeMatch(ans, SOURCES), 'The capital of France is Paris and the Eiffel Tower is a popular landmark.')
})

test('picks the BEST source when several overlap', () => {
  const ans = 'Mitigation options include reverse osmosis filtration and rainwater collection.'
  const out = citeMatch(ans, SOURCES)
  assert.match(out, /\[3\]/)
})

test('marker goes inside the terminal punctuation', () => {
  const ans = 'Lead concentrations exceeded the federal action level in several samples!'
  const out = citeMatch(ans, SOURCES)
  assert.match(out, /samples \[1\]!$/)
})

test('handles multi-sentence prose, citing each grounded sentence independently', () => {
  const ans = 'Lead concentrations exceeded the federal action level in several samples. Mitigation options include reverse osmosis filtration.'
  const out = citeMatch(ans, SOURCES)
  assert.match(out, /\[1\]\./)
  assert.match(out, /\[3\]\./)
})

test('leaves headings, code fences and tables alone', () => {
  const ans = '# Findings\n```\nlead = 0.02\n```\n| a | b |'
  assert.equal(citeMatch(ans, SOURCES), ans)
})

test('thin sentences (< 2 content tokens) are not attributed', () => {
  assert.equal(bestSource('Yes it did.', SOURCES), null)
})

test('bestSource respects the floor', () => {
  // one shared content word out of many → below the 0.5 floor → no attribution
  assert.equal(bestSource('Lead pipes corrode in old infrastructure across the county network.', SOURCES, 0.5), null)
})

test('citationCoverage measures the cited fraction', () => {
  const a = citationCoverage('Plants rely on tap water [2]. Mitigation includes filtration [3]. Some unrelated remark about birds migrating south.')
  assert.equal(a.sentences, 3)
  assert.equal(a.cited, 2)
  assert.ok(a.coverage > 0.6 && a.coverage < 0.7)
})

test('contentTokens drops stopwords and short words', () => {
  const t = contentTokens('The water has been tested')
  assert.ok(t.has('water') && t.has('tested'))
  assert.ok(!t.has('the') && !t.has('has'))
})
