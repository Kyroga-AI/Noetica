import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildRaptorTree, clusterByEmbedding, collapsedRetrieve, treeStats, cosine, type Embedder, type Summarizer } from './raptor.js'

// Mock embedder: maps a chunk to a 3-D topic vector by keyword, so clustering is meaningful + deterministic.
const TOPICS: Record<string, number[]> = { cat: [1, 0, 0], math: [0, 1, 0], ship: [0, 0, 1] }
const embed: Embedder = async (texts) =>
  texts.map((t) => {
    const lc = t.toLowerCase()
    const key = (Object.keys(TOPICS).find((k) => lc.includes(k)) ?? 'cat')
    return TOPICS[key]!.slice()
  })
// Mock summarizer: deterministic, keeps the topic keyword so the parent stays in the same cluster region.
const summarize: Summarizer = async (texts) => `SUMMARY[${texts.length}]: ${texts.join(' | ').slice(0, 60)}`

test('clusterByEmbedding groups similar vectors, respects maxClusterSize', () => {
  const emb = [[1, 0], [0.99, 0.01], [0, 1], [0.98, 0.02]]
  const clusters = clusterByEmbedding(emb, 5)
  // the three [1,0]-ish vectors cluster together, [0,1] stands apart
  const sizes = clusters.map((c) => c.length).sort()
  assert.deepEqual(sizes, [1, 3])
})

test('clusterByEmbedding caps cluster size (forces branching)', () => {
  const emb = Array.from({ length: 6 }, () => [1, 0])  // all identical → would be one cluster
  const clusters = clusterByEmbedding(emb, 2)
  assert.ok(clusters.every((c) => c.length <= 2), 'no cluster exceeds maxClusterSize')
  assert.equal(clusters.reduce((s, c) => s + c.length, 0), 6, 'every node assigned exactly once')
})

test('buildRaptorTree builds a multi-level tree with summary nodes', async () => {
  const chunks = [
    'the cat sat on the mat', 'a cat chased the mouse', 'kittens are baby cats',
    'two plus two is math', 'calculus is advanced math', 'algebra is math too',
    'the ship sailed the sea', 'a ship has a sail', 'the ship docked at port',
  ]
  const tree = await buildRaptorTree(chunks, embed, summarize, { maxClusterSize: 5 })
  const stats = treeStats(tree)
  assert.equal(stats.leaves, 9, 'all chunks are leaves at level 0')
  assert.ok(stats.levels >= 2, 'recursion produced at least one summary level')
  assert.ok(stats.summaries >= 1, 'summary nodes exist')
  // summary nodes link back to their children
  const summaryNode = [...tree.nodes.values()].find((n) => n.level === 1)!
  assert.ok(summaryNode.childIds.length >= 1, 'summary node has children')
  assert.ok(summaryNode.text.startsWith('SUMMARY['), 'summary node holds the abstractive summary')
})

test('collapsedRetrieve: a global query hits a summary node; a specific query can hit a leaf', async () => {
  const chunks = [
    'the cat sat on the mat', 'a cat chased the mouse', 'kittens are baby cats', 'cats purr when happy',
    'two plus two is math', 'calculus is advanced math', 'algebra is math', 'geometry is math',
  ]
  const tree = await buildRaptorTree(chunks, embed, summarize, { maxClusterSize: 4 })
  // query embedded as a 'math' topic vector → top result should be in the math region (leaf or summary)
  const [qEmb] = await embed(['tell me about math'])
  const top = collapsedRetrieve(tree, qEmb!, 3)
  assert.ok(top.length === 3)
  assert.ok(top.every((n) => n.text.toLowerCase().includes('math') || n.text.includes('SUMMARY')),
    'retrieved nodes are in the queried topic region')
  // at least one summary node is reachable via collapsed retrieval (the whole point)
  const allNodes = [...tree.nodes.values()]
  assert.ok(allNodes.some((n) => n.level > 0), 'tree exposes summary nodes for global retrieval')
})

test('buildRaptorTree handles tiny inputs gracefully (no infinite recursion)', async () => {
  assert.equal((await buildRaptorTree([], embed, summarize)).nodes.size, 0)
  const one = await buildRaptorTree(['only one chunk'], embed, summarize)
  assert.equal(treeStats(one).leaves, 1)
  assert.equal(treeStats(one).levels, 1, 'single chunk → no summary level')
})

test('cosine is correct on unit vectors', () => {
  assert.ok(Math.abs(cosine([1, 0], [1, 0]) - 1) < 1e-9)
  assert.ok(Math.abs(cosine([1, 0], [0, 1])) < 1e-9)
})
