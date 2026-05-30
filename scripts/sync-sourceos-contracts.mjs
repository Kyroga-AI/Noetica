#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const SOURCEOS_SPEC_REF = 'c7f8c2d9e42a56e1127c2f9b85649cbea0f0a9fa'
const SOURCE_PATH = 'generated/typescript/sourceos-interaction-event.ts'
const TARGET_PATH = 'lib/contracts/sourceos/generated/sourceos-interaction-event.ts'
const SOURCE_URL = `https://raw.githubusercontent.com/SourceOS-Linux/sourceos-spec/${SOURCEOS_SPEC_REF}/${SOURCE_PATH}`
const HEADER = `// Generated from schemas/SourceOSInteractionEvent.json.\n// Do not edit by hand. Source: SourceOS-Linux/sourceos-spec ${SOURCE_PATH}\n// Pinned sourceos-spec commit: ${SOURCEOS_SPEC_REF}\n\n`

const mode = process.argv[2] ?? '--check'

if (!['--check', '--write'].includes(mode)) {
  console.error('usage: node scripts/sync-sourceos-contracts.mjs [--check|--write]')
  process.exit(2)
}

const upstream = await fetchText(SOURCE_URL)
const normalized = normalizeGeneratedArtifact(upstream)

if (mode === '--write') {
  await mkdir(path.dirname(TARGET_PATH), { recursive: true })
  await writeFile(TARGET_PATH, normalized, 'utf8')
  console.log(`synced ${TARGET_PATH} from ${SOURCE_URL}`)
  process.exit(0)
}

let current = ''
try {
  current = await readFile(TARGET_PATH, 'utf8')
} catch (error) {
  console.error(`missing vendored contract: ${TARGET_PATH}`)
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}

if (current !== normalized) {
  console.error(`vendored SourceOS contract is stale: ${TARGET_PATH}`)
  console.error(`source: ${SOURCE_URL}`)
  console.error('run: node scripts/sync-sourceos-contracts.mjs --write')
  process.exit(1)
}

console.log(`SourceOS contracts are current at ${SOURCEOS_SPEC_REF}`)

async function fetchText(url) {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`failed to fetch ${url}: ${response.status} ${response.statusText}`)
  }
  return response.text()
}

function normalizeGeneratedArtifact(content) {
  const withoutGeneratedHeader = content.replace(/^\/\/ Generated from schemas\/SourceOSInteractionEvent\.json\.\n\/\/ Do not edit by hand\. Run: python tools\/generate_sourceos_interaction_types\.py\n\n/, '')
  return HEADER + withoutGeneratedHeader
}
