import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isSelfQuery, selfModelSummary, selfGroundingBlock, CONSTRUCTION_REPOS, extractRepoIdentity } from './self-model.js'

test('isSelfQuery detects self/construction questions, not generic ones', () => {
  assert.equal(isSelfQuery('how do you work?'), true)
  assert.equal(isSelfQuery('what repos build you?'), true)
  assert.equal(isSelfQuery('do you have knowledge of your own construction?'), true)
  assert.equal(isSelfQuery('what is the capital of France?'), false)
})

test('selfModelSummary exposes all 6 repos + relations', () => {
  const s = selfModelSummary()
  assert.equal(s.repos.length, 6)
  assert.ok(s.edges.some((e) => e.from === 'noetica' && e.rel === 'CONSUMES' && e.to === 'hellgraph'))
  assert.ok(s.edges.some((e) => e.rel === 'SOURCES_FROM'))
})

test('selfGroundingBlock names Noetica + the engines', () => {
  const b = selfGroundingBlock()
  assert.ok(b.includes('hellgraph') && b.includes('graphbrain-contract') && b.includes('Noetica'))
})

test('extractRepoIdentity reads grounded text when the repo is on disk', () => {
  const noetica = CONSTRUCTION_REPOS.find((r) => r.name === 'noetica')!
  const text = extractRepoIdentity(noetica)
  assert.ok(text.includes('noetica') && text.length > 50)
})
