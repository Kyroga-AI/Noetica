#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { scoreRiskAversionTurn } from '../lib/risk/riskAversionScorer.mjs'

async function main(argv) {
  const args = parseArgs(argv)
  const inputFile = args.file ?? 'examples/risk-aversion/chatgpt-crash-corpus.accepted.json'
  const outputDir = args.outDir ?? '.noetica/risk-aversion'
  const corpus = JSON.parse(await readFile(inputFile, 'utf8'))
  validateCorpus(corpus)

  const scoredTurns = corpus.turns.map((turn) => scoreRiskAversionTurn({
    turnId: turn.turnId,
    userText: turn.userText,
    assistantText: turn.assistantText,
    evidenceRefs: turn.evidenceRefs ?? [],
    runtimeEventRefs: turn.runtimeEventRefs ?? []
  }))

  const graph = buildRiskAversionGraph({ corpus, scoredTurns })
  const matrix = buildRiskAversionMatrix(scoredTurns)

  await mkdir(outputDir, { recursive: true })
  await writeJson(join(outputDir, 'risk-aversion-graph.json'), graph)
  await writeFile(join(outputDir, 'risk-aversion-graph.dot'), toDot(graph), 'utf8')
  await writeFile(join(outputDir, 'risk-aversion-graph.mmd'), toMermaid(graph), 'utf8')
  await writeJson(join(outputDir, 'risk-aversion-matrix.json'), matrix)
  await writeFile(join(outputDir, 'risk-aversion-matrix.csv'), toCsv(matrix), 'utf8')

  console.log(JSON.stringify({
    ok: true,
    inputFile,
    outputDir,
    artifacts: [
      'risk-aversion-graph.json',
      'risk-aversion-graph.dot',
      'risk-aversion-graph.mmd',
      'risk-aversion-matrix.json',
      'risk-aversion-matrix.csv'
    ]
  }, null, 2))
}

export function buildRiskAversionGraph({ corpus, scoredTurns }) {
  const nodes = [
    { id: corpus.corpusId, label: corpus.title, kind: 'corpus' }
  ]
  const edges = []

  for (const turn of scoredTurns) {
    const turnNode = `turn:${turn.turnId}`
    const riskNode = `risk:${turn.turnId}`
    const outcomeNode = `outcome:${turn.turnId}`

    nodes.push(
      { id: turnNode, label: turn.turnId, kind: 'turn' },
      { id: riskNode, label: `risk ${turn.riskVector.aggregateScore}`, kind: 'risk_vector' },
      { id: outcomeNode, label: turn.outcomeCard.impact, kind: 'outcome' }
    )

    edges.push(
      { source: corpus.corpusId, target: turnNode, label: 'contains' },
      { source: turnNode, target: riskNode, label: 'scores' },
      { source: riskNode, target: outcomeNode, label: 'steers' }
    )

    for (const mode of turn.observedSteeringModes) {
      const modeNode = `steering:${mode}`
      if (!nodes.some((node) => node.id === modeNode)) {
        nodes.push({ id: modeNode, label: mode, kind: 'steering_mode' })
      }
      edges.push({ source: riskNode, target: modeNode, label: 'observed_mode' })
      edges.push({ source: modeNode, target: outcomeNode, label: 'contributes' })
    }

    for (const dimension of turn.riskVector.dimensions.filter((item) => item.score > 0)) {
      const dimensionNode = `dimension:${dimension.dimension}`
      if (!nodes.some((node) => node.id === dimensionNode)) {
        nodes.push({ id: dimensionNode, label: dimension.dimension, kind: 'risk_dimension' })
      }
      edges.push({
        source: dimensionNode,
        target: riskNode,
        label: String(dimension.score),
        weight: dimension.score,
        evidenceTerms: dimension.evidenceTerms
      })
    }
  }

  return {
    schemaVersion: 'noetica.risk_aversion_graph.v0.1',
    corpusId: corpus.corpusId,
    nodes,
    edges
  }
}

export function buildRiskAversionMatrix(scoredTurns) {
  return scoredTurns.map((turn) => ({
    turnId: turn.turnId,
    aggregateScore: turn.riskVector.aggregateScore,
    observedSteeringModes: turn.observedSteeringModes.join('|'),
    outcomeImpact: turn.outcomeCard.impact,
    ...Object.fromEntries(turn.riskVector.dimensions.map((dimension) => [dimension.dimension, dimension.score]))
  }))
}

function toDot(graph) {
  const lines = ['digraph RiskAversion {', '  rankdir=LR;']
  for (const node of graph.nodes) {
    lines.push(`  "${escapeDot(node.id)}" [label="${escapeDot(node.label)}", shape=${shapeFor(node.kind)}];`)
  }
  for (const edge of graph.edges) {
    const label = edge.label ? ` [label="${escapeDot(edge.label)}"]` : ''
    lines.push(`  "${escapeDot(edge.source)}" -> "${escapeDot(edge.target)}"${label};`)
  }
  lines.push('}')
  return `${lines.join('\n')}\n`
}

function toMermaid(graph) {
  const lines = ['flowchart LR']
  for (const node of graph.nodes) {
    lines.push(`  ${mermaidId(node.id)}["${escapeMermaid(node.label)}"]`)
  }
  for (const edge of graph.edges) {
    const label = edge.label ? `|${escapeMermaid(edge.label)}|` : ''
    lines.push(`  ${mermaidId(edge.source)} -->${label} ${mermaidId(edge.target)}`)
  }
  return `${lines.join('\n')}\n`
}

function toCsv(rows) {
  const headers = Array.from(rows.reduce((keys, row) => {
    Object.keys(row).forEach((key) => keys.add(key))
    return keys
  }, new Set()))

  return [headers.join(','), ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(','))].join('\n') + '\n'
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(value, null, 2), 'utf8')
}

function validateCorpus(corpus) {
  if (corpus.schemaVersion !== 'noetica.risk_aversion_corpus.v0.1') throw new Error('invalid corpus schemaVersion')
  if (!Array.isArray(corpus.turns) || corpus.turns.length === 0) throw new Error('corpus requires turns')
}

function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--file') args.file = argv[++i]
    else if (arg === '--out-dir') args.outDir = argv[++i]
    else throw new Error(`unknown argument: ${arg}`)
  }
  return args
}

function shapeFor(kind) {
  if (kind === 'corpus') return 'box'
  if (kind === 'risk_vector') return 'diamond'
  if (kind === 'outcome') return 'doublecircle'
  return 'ellipse'
}

function mermaidId(value) {
  return value.replace(/[^a-zA-Z0-9_]/g, '_')
}

function escapeDot(value) {
  return String(value).replace(/"/g, '\\"')
}

function escapeMermaid(value) {
  return String(value).replace(/"/g, '#quot;')
}

function csvCell(value) {
  if (value === null || value === undefined) return ''
  const text = String(value)
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
