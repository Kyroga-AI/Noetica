/** Tests for the life-domain tagger — safety disclaimers + fresh-info routing. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyLifeDomain } from './life-domain.js'

test('health questions get a medical disclaimer and no web', () => {
  const d = classifyLifeDomain('what is a home remedy for a sore throat')
  assert.equal(d.domain, 'health')
  assert.match(d.safetyNote, /not a medical professional/i)
  assert.equal(d.needsWeb, false)
})

test('finance questions get the not-a-financial-advisor disclaimer', () => {
  const d = classifyLifeDomain('should i invest my savings in an index fund')
  assert.equal(d.domain, 'finance')
  assert.match(d.safetyNote, /not a licensed financial advisor/i)
})

test('legal questions get the not-a-lawyer disclaimer', () => {
  const d = classifyLifeDomain('can my landlord evict me without notice, what are my rights')
  assert.equal(d.domain, 'legal')
  assert.match(d.safetyNote, /not a lawyer/i)
})

test('hazardous repair defers to a licensed professional', () => {
  const d = classifyLifeDomain('how do i fix the electrical panel breaker box')
  assert.equal(d.domain, 'home_repair')
  assert.match(d.safetyNote, /licensed professional/i)
})

test('travel and local questions allow web (fresh info), no disclaimer', () => {
  assert.equal(classifyLifeDomain('what should i pack for a trip to iceland').needsWeb, true)
  assert.equal(classifyLifeDomain('best restaurants near me open now').needsWeb, true)
  assert.equal(classifyLifeDomain('best restaurants near me open now').safetyNote, '')
})

test('a plain everyday question is neutral — no disclaimer, no web', () => {
  const d = classifyLifeDomain('how do i make coffee')
  assert.equal(d.domain, 'everyday')
  assert.equal(d.safetyNote, '')
  assert.equal(d.needsWeb, false)
})
