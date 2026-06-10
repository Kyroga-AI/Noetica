#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { scoreRiskAversionTurn } from '../lib/risk/riskAversionScorer.mjs'
import { resolveRiskAversionExportDir } from './risk-aversion-export-path.mjs'

const DEFAULT_CORPUS = 'examples/risk-aversion/chatgpt-crash-corpus.accepted.json'

async function main(argv) {
  const args = parseArgs(argv)
  const corpusPath = args.file ?? DEFAULT_CORPUS
  const outputDir = args.outDir ?? resolveRiskAversionExportDir({ mode: args.mode })
  const corpus = JSON.parse(await readFile(corpusPath, 'utf8'))
  validateCorpus(corpus)

  await rm(outputDir, { recursive: true, force: true })
  await mkdir(outputDir, { recursive: true })

  const exported = []
  for (const turn of corpus.turns) {
    const trace = scoreRiskAversionTurn({
      turnId: turn.turnId,
      userText: turn.userText,
      assistantText: turn.assistantText,
      evidenceRefs: turn.evidenceRefs ?? [],
      runtimeEventRefs: turn.runtimeEventRefs ?? []
    })
    const serialized = `${JSON.stringify(trace, null, 2)}\n`
    const traceHash = sha256(serialized)
    const traceRef = `urn:noetica:risk-trace:${safeSlug(trace.turnId)}`
    const filename = `${safeSlug(trace.turnId)}.risk-trace.json`
    const outputPath = join(outputDir, filename)
    await writeFile(outputPath, serialized, 'utf8')
    exported.push({
      turnId: trace.turnId,
      traceRef,
      traceHash,
      outputPath,
      aggregateScore: trace.riskVector.aggregateScore,
      observedSteeringModes: trace.observedSteeringModes,
      outcomeImpact: trace.outcomeCard.impact
    })
  }

  const manifest = {
    schemaVersion: 'noetica.risk_aversion_export_manifest.v0.1',
    kind: 'NoeticaRiskAversionTraceExport',
    status: 'ok',
    corpusId: corpus.corpusId,
    corpusPath,
    corpusHash: sha256(`${JSON.stringify(corpus, null, 2)}\n`),
    outputDir,
    exported
  }

  await writeFile(join(outputDir, 'risk-aversion-export-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify(manifest, null, 2))
}

function validateCorpus(corpus) {
  if (corpus.schemaVersion !== 'noetica.risk_aversion_corpus.v0.1') throw new Error('invalid corpus schemaVersion')
  if (!corpus.corpusId) throw new Error('missing corpusId')
  if (!Array.isArray(corpus.turns) || corpus.turns.length === 0) throw new Error('corpus requires turns')
  for (const turn of corpus.turns) {
    if (!turn.turnId) throw new Error('turn missing turnId')
    if (typeof turn.userText !== 'string') throw new Error(`${turn.turnId}: missing userText`)
    if (typeof turn.assistantText !== 'string') throw new Error(`${turn.turnId}: missing assistantText`)
  }
}

function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--file') args.file = argv[++i]
    else if (arg === '--out-dir') args.outDir = argv[++i]
    else if (arg === '--mode') args.mode = argv[++i]
    else throw new Error(`unknown argument: ${arg}`)
  }
  return args
}

function safeSlug(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9._:-]+/g, '-').replace(/^-+|-+$/g, '') || 'trace'
}

function sha256(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
