#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { scoreRiskAversionTurn } from '../lib/risk/riskAversionScorer.mjs'

async function main(argv) {
  const args = parseArgs(argv)
  const input = args.file ? JSON.parse(await readFile(args.file, 'utf8')) : buildInlineInput(args)

  if (input.schemaVersion === 'noetica.risk_aversion_corpus.v0.1') {
    const scored = {
      ...input,
      turns: input.turns.map((turn) => scoreRiskAversionTurn({
        turnId: turn.turnId,
        userText: turn.userText ?? '',
        assistantText: turn.assistantText ?? '',
        evidenceRefs: turn.evidenceRefs ?? [],
        runtimeEventRefs: turn.runtimeEventRefs ?? []
      }))
    }
    console.log(JSON.stringify(scored, null, 2))
    return
  }

  console.log(JSON.stringify(scoreRiskAversionTurn(input), null, 2))
}

function buildInlineInput(args) {
  return {
    turnId: args.turnId ?? 'turn-inline-0001',
    userText: args.userText ?? '',
    assistantText: args.assistantText ?? '',
    evidenceRefs: [],
    runtimeEventRefs: []
  }
}

function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--file') {
      args.file = argv[++i]
    } else if (arg === '--turn-id') {
      args.turnId = argv[++i]
    } else if (arg === '--user-text') {
      args.userText = argv[++i]
    } else if (arg === '--assistant-text') {
      args.assistantText = argv[++i]
    } else {
      throw new Error(`unknown argument: ${arg}`)
    }
  }
  return args
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
