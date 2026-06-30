/** Tests for the STORM knowledge-curation orchestrator. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  runStorm, discoverPerspectives, interview, parseOutline, synthesizeOutline,
  type Runner, type Retrieve,
} from './storm-curate.js'

/** A scripted runner: routes by what the prompt is asking for, so we exercise the real control flow. */
function scriptedRunner(): Runner {
  let qCount = 0
  return async (prompt: string) => {
    if (/DISTINCT perspectives/i.test(prompt)) {
      return '- Historian\n- Engineer\n- Skeptic'
    }
    if (/ask the single most important question|ask ONE follow-up/i.test(prompt)) {
      qCount++
      return `Question ${qCount}?`
    }
    if (/Answer the question using ONLY the sources/i.test(prompt)) {
      return 'Grounded answer.'
    }
    if (/hierarchical article outline/i.test(prompt)) {
      return '# Background\n## Origins\n## Timeline\n# Mechanism\n## Core idea\n# Criticism'
    }
    return ''
  }
}

const retrieve: Retrieve = (q, k) => Array.from({ length: k }, (_, i) => `snippet ${i + 1} for "${q}"`)

test('discoverPerspectives parses a bulleted list', async () => {
  const ps = await discoverPerspectives('quantum computing', scriptedRunner(), 3)
  assert.deepEqual(ps, ['Historian', 'Engineer', 'Skeptic'])
})

test('discoverPerspectives falls back to a default when the model returns nothing', async () => {
  const empty: Runner = async () => ''
  const ps = await discoverPerspectives('x', empty, 3)
  assert.deepEqual(ps, ['general overview'])
})

test('interview produces grounded Q&A for the requested rounds', async () => {
  const trail = await interview('topic', 'Engineer', {
    runner: scriptedRunner(), retrieve, rounds: 2, retrieveK: 3,
  })
  assert.equal(trail.length, 2)
  assert.equal(trail[0]!.perspective, 'Engineer')
  assert.ok(trail[0]!.question.length > 0)
  assert.equal(trail[0]!.answer, 'Grounded answer.')
  assert.equal(trail[0]!.citations.length, 3)
})

test('parseOutline builds a two-level tree', () => {
  const tree = parseOutline('# Background\n## Origins\n## Timeline\n# Mechanism\n## Core idea')
  assert.equal(tree.length, 2)
  assert.equal(tree[0]!.heading, 'Background')
  assert.deepEqual(tree[0]!.children.map((c) => c.heading), ['Origins', 'Timeline'])
  assert.equal(tree[1]!.children[0]!.heading, 'Core idea')
})

test('parseOutline tolerates bullet headings when the model ignores #', () => {
  const tree = parseOutline('- Intro\n- Details\n- Conclusion')
  assert.deepEqual(tree.map((n) => n.heading), ['Intro', 'Details', 'Conclusion'])
})

test('synthesizeOutline turns conversations into an outline', async () => {
  const outline = await synthesizeOutline(
    't',
    [{ perspective: 'Engineer', question: 'how?', answer: 'thus', citations: [] }],
    scriptedRunner(),
  )
  assert.ok(outline.length >= 1)
  assert.equal(outline[0]!.heading, 'Background')
})

test('runStorm wires the full pipeline end to end', async () => {
  const result = await runStorm('history of encryption', {
    runner: scriptedRunner(), retrieve, perspectives: 3, rounds: 2, retrieveK: 2,
  })
  assert.equal(result.topic, 'history of encryption')
  assert.equal(result.perspectives.length, 3)
  // 3 perspectives × 2 rounds = 6 Q&A pairs.
  assert.equal(result.conversations.length, 6)
  // Every answer is grounded with citations from the retriever.
  assert.ok(result.conversations.every((c) => c.citations.length === 2))
  assert.ok(result.outline.length >= 2)
})
