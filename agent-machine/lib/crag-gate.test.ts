import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cragVote, gateShouldRetrieve, acceptRetrievedAnswer, DEFAULT_GATE_THRESHOLD } from './crag-gate.js'

// A deterministic sampler: returns the s-th canned answer (cycling if k exceeds the list). No model calls.
const seq = (answers: string[]) => (s: number) => Promise.resolve(answers[s % answers.length]!)
const identity = (raw: string) => (raw.trim() === '' ? null : raw.trim())

// ── cragVote: voting + agreement ──────────────────────────────────────────────
test('cragVote returns the majority and its agreement fraction', async () => {
  const r = await cragVote(seq(['A', 'A', 'B', 'A', 'C']), identity, 5, { earlyStop: false })
  assert.equal(r.choice, 'A')
  assert.equal(r.agree, 3 / 5)   // 3 of 5 votes
  assert.equal(r.n, 5)
})

test('cragVote with unanimous samples reports agree=1 (a confident closed-book answer)', async () => {
  const r = await cragVote(seq(['B', 'B', 'B', 'B', 'B']), identity, 5)
  assert.equal(r.choice, 'B')
  assert.equal(r.agree, 1)
})

test('cragVote k<=1 collapses to a single draw (voting off)', async () => {
  const r = await cragVote(seq(['D', 'A', 'A']), identity, 1)
  assert.equal(r.choice, 'D')
  assert.equal(r.agree, 1)
  assert.equal(r.n, 1)
})

test('cragVote Adaptive-SC early-stops once the leader is uncatchable (fewer model calls)', async () => {
  // 5 requested, but A leads 3–0 after 3 draws → the 2 remaining can't catch it → stop at n=3.
  let calls = 0
  const sample = (s: number) => { calls++; return Promise.resolve(['A', 'A', 'A', 'B', 'B'][s]!) }
  const r = await cragVote(sample, identity, 5, { earlyStop: true })
  assert.equal(r.choice, 'A')
  assert.equal(r.n, 3, 'stopped after 3 draws')
  assert.equal(calls, 3, 'only 3 model calls made')
})

test('cragVote without early-stop draws all k', async () => {
  let calls = 0
  const sample = (s: number) => { calls++; return Promise.resolve(['A', 'A', 'A', 'B', 'B'][s]!) }
  await cragVote(sample, identity, 5, { earlyStop: false })
  assert.equal(calls, 5)
})

test('cragVote CISC weights votes by stated confidence — a confident minority can win', async () => {
  // 3 low-confidence A's (0.2 each = 0.6) vs 2 high-confidence B's (0.9 each = 1.8) → B wins on weight.
  const raws = ['A|0.2', 'B|0.9', 'A|0.2', 'B|0.9', 'A|0.2']
  const r = await cragVote(
    seq(raws),
    (raw) => raw.split('|')[0]!,
    5,
    { weight: (raw) => Number(raw.split('|')[1]), earlyStop: false },
  )
  assert.equal(r.choice, 'B')
  assert.ok(Math.abs(r.agree - 1.8 / 2.4) < 1e-9, `agree should be the weighted fraction, got ${r.agree}`)
})

test('cragVote uses the fallback when no sample extracts a key, with agree=0', async () => {
  let fb = 0
  const r = await cragVote(seq(['', '', '']), identity, 3, { fallback: () => { fb++; return Promise.resolve('C') } })
  assert.equal(r.choice, 'C')
  assert.equal(r.agree, 0, 'a fallback draw carries no confidence')
  assert.equal(fb, 1, 'fallback drawn exactly once')
})

test('cragVote with no votes and no fallback abstains (empty choice, agree 0)', async () => {
  const r = await cragVote(seq(['', '', '']), identity, 3)
  assert.equal(r.choice, '')
  assert.equal(r.agree, 0)
})

// ── the gate decision: skip vs retrieve ───────────────────────────────────────
test('gateShouldRetrieve: confident closed-book (agree >= 0.8) SKIPS retrieval', () => {
  assert.equal(gateShouldRetrieve(0.8), false)   // at threshold → skip
  assert.equal(gateShouldRetrieve(1.0), false)
  assert.equal(gateShouldRetrieve(0.79), true)   // below → retrieve
  assert.equal(gateShouldRetrieve(0.5), true)
})

test('gateShouldRetrieve threshold is tunable', () => {
  assert.equal(gateShouldRetrieve(0.7, 0.6), false, 'agree above a lower threshold → skip')
  assert.equal(gateShouldRetrieve(0.7, 0.9), true, 'agree below a higher threshold → retrieve')
})

test('DEFAULT_GATE_THRESHOLD is the board-proven 0.8', () => {
  assert.equal(DEFAULT_GATE_THRESHOLD, 0.8)
})

// ── the CRAG correction: accept retrieval only if it didn't lower confidence ───
test('acceptRetrievedAnswer keeps retrieval when it is at least as self-consistent', () => {
  assert.equal(acceptRetrievedAnswer(0.9, 0.6), true)    // retrieval more confident → take it
  assert.equal(acceptRetrievedAnswer(0.6, 0.6), true)    // tie → take retrieval
  assert.equal(acceptRetrievedAnswer(0.4, 0.6), false)   // retrieval LESS confident → keep closed-book (noisy chunks)
})

// ── end-to-end gate flow on synthetic confidence signals ──────────────────────
test('gate flow: a confident question skips retrieval; an uncertain one retrieves and may be corrected', async () => {
  // Confident: closed-book is unanimous → skip, answer = closed-book.
  const closedConfident = await cragVote(seq(['A', 'A', 'A', 'A', 'A']), identity, 5)
  assert.equal(gateShouldRetrieve(closedConfident.agree), false)

  // Uncertain: closed-book splits 3/5 → retrieve.
  const closedUncertain = await cragVote(seq(['A', 'B', 'A', 'C', 'A']), identity, 5, { earlyStop: false })
  assert.equal(gateShouldRetrieve(closedUncertain.agree), true)
  // Retrieval comes back MORE consistent (4/5) → CRAG accepts it.
  const retrieved = await cragVote(seq(['B', 'B', 'B', 'B', 'A']), identity, 5, { earlyStop: false })
  assert.equal(acceptRetrievedAnswer(retrieved.agree, closedUncertain.agree), true)
  assert.equal(retrieved.choice, 'B')
})
