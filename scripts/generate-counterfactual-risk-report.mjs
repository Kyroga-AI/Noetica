#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { scoreRiskAversionTurn } from '../lib/risk/riskAversionScorer.mjs'

const DEFAULT_REPLAY = 'examples/risk-aversion/counterfactual-replay.accepted.json'
const DEFAULT_OUT_DIR = '.noetica/risk-aversion/counterfactual'
const REQUIRED_ORDERING = ['neutral', 'forensic', 'culpability', 'attribution']

async function main(argv) {
  const args = parseArgs(argv)
  const replayPath = args.file ?? DEFAULT_REPLAY
  const outDir = args.outDir ?? DEFAULT_OUT_DIR
  const replay = JSON.parse(await readFile(replayPath, 'utf8'))
  validateReplayShape(replay)

  const report = buildCounterfactualRiskReport(replay)
  await mkdir(outDir, { recursive: true })
  await writeJson(join(outDir, 'counterfactual-risk-report.json'), report)
  await writeFile(join(outDir, 'counterfactual-risk-report.csv'), toCsv(report.scoredVariants), 'utf8')
  await writeFile(join(outDir, 'counterfactual-risk-report.mmd'), toMermaid(report), 'utf8')
  await writeFile(join(outDir, 'counterfactual-risk-report.dot'), toDot(report), 'utf8')

  console.log(JSON.stringify({
    ok: true,
    replayPath,
    outDir,
    artifacts: [
      'counterfactual-risk-report.json',
      'counterfactual-risk-report.csv',
      'counterfactual-risk-report.mmd',
      'counterfactual-risk-report.dot'
    ],
    monotonic: report.monotonic,
    totalDelta: report.totalDelta
  }, null, 2))
}

export function buildCounterfactualRiskReport(replay) {
  validateReplayShape(replay)
  const byId = new Map(replay.variants.map((variant) => [variant.variantId, variant]))
  const scoredVariants = REQUIRED_ORDERING.map((variantId, index) => {
    const variant = byId.get(variantId)
    const trace = scoreRiskAversionTurn({
      turnId: `counterfactual-${variantId}`,
      userText: variant.userText,
      assistantText: variant.assistantText,
      evidenceRefs: [`urn:noetica:counterfactual-replay:${replay.replayId}`],
      runtimeEventRefs: []
    })

    return {
      order: index,
      variantId,
      label: variant.label,
      expectedRiskBand: variant.expectedRiskBand,
      aggregateScore: trace.riskVector.aggregateScore,
      cautionDelta: trace.deflectionDelta.cautionDelta,
      attributionSuppressionDelta: trace.deflectionDelta.attributionSuppressionDelta,
      hypothesisReframingDelta: trace.deflectionDelta.hypothesisReframingDelta,
      observedSteeringModes: trace.observedSteeringModes.join('|'),
      outcomeImpact: trace.outcomeCard.impact
    }
  })

  const edges = []
  for (let index = 1; index < scoredVariants.length; index += 1) {
    const previous = scoredVariants[index - 1]
    const current = scoredVariants[index]
    edges.push({
      source: previous.variantId,
      target: current.variantId,
      riskDelta: round3(current.aggregateScore - previous.aggregateScore),
      cautionDelta: round3(current.cautionDelta - previous.cautionDelta),
      attributionSuppressionDelta: round3(current.attributionSuppressionDelta - previous.attributionSuppressionDelta),
      hypothesisReframingDelta: round3(current.hypothesisReframingDelta - previous.hypothesisReframingDelta)
    })
  }

  const totalDelta = round3(scoredVariants[scoredVariants.length - 1].aggregateScore - scoredVariants[0].aggregateScore)
  const monotonic = edges.every((edge) => edge.riskDelta >= 0)

  return {
    schemaVersion: 'noetica.counterfactual_risk_report.v0.1',
    replayId: replay.replayId,
    title: replay.title,
    ordering: REQUIRED_ORDERING,
    monotonic,
    totalDelta,
    interpretation: monotonic
      ? 'Risk-aversion pressure is non-decreasing across the controlled frame sequence.'
      : 'Risk-aversion pressure is not monotonic; inspect variant wording and scorer calibration.',
    scoredVariants,
    edges
  }
}

function validateReplayShape(replay) {
  if (replay.schemaVersion !== 'noetica.counterfactual_replay.v0.1') throw new Error('invalid replay schemaVersion')
  if (!replay.replayId) throw new Error('missing replayId')
  if (!Array.isArray(replay.variants)) throw new Error('missing variants')
  const byId = new Map(replay.variants.map((variant) => [variant.variantId, variant]))
  for (const variantId of REQUIRED_ORDERING) {
    if (!byId.has(variantId)) throw new Error(`missing variant: ${variantId}`)
  }
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function toCsv(rows) {
  const headers = Object.keys(rows[0] ?? {})
  return [headers.join(','), ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(','))].join('\n') + '\n'
}

function toMermaid(report) {
  const lines = ['flowchart LR']
  for (const variant of report.scoredVariants) {
    lines.push(`  ${variant.variantId}["${escapeMermaid(variant.label)}<br/>risk ${variant.aggregateScore}"]`)
  }
  for (const edge of report.edges) {
    lines.push(`  ${edge.source} -->|risk Δ ${edge.riskDelta}| ${edge.target}`)
  }
  return `${lines.join('\n')}\n`
}

function toDot(report) {
  const lines = ['digraph CounterfactualRiskReplay {', '  rankdir=LR;']
  for (const variant of report.scoredVariants) {
    lines.push(`  "${escapeDot(variant.variantId)}" [label="${escapeDot(`${variant.label}\nrisk ${variant.aggregateScore}`)}", shape=box];`)
  }
  for (const edge of report.edges) {
    lines.push(`  "${escapeDot(edge.source)}" -> "${escapeDot(edge.target)}" [label="risk Δ ${edge.riskDelta}"];`)
  }
  lines.push('}')
  return `${lines.join('\n')}\n`
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

function csvCell(value) {
  if (value === null || value === undefined) return ''
  const text = String(value)
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function escapeMermaid(value) {
  return String(value).replace(/"/g, '#quot;')
}

function escapeDot(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function round3(value) {
  return Math.round(value * 1000) / 1000
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
