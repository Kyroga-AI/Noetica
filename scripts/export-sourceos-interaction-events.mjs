#!/usr/bin/env node
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'

import { resolveSourceOSEventExportDir } from './sourceos-event-export-path.mjs'

const fixtureDir = 'tests/fixtures/sourceos-interaction'
const outputDir = resolveSourceOSEventExportDir()
const fixtures = [
  'noetica-local-service-status.interaction.json',
  'noetica-chat-completion-via-transport.interaction.json'
]

await rm(outputDir, { recursive: true, force: true })
await mkdir(outputDir, { recursive: true })

const exported = []

for (const fixture of fixtures) {
  const sourcePath = join(fixtureDir, fixture)
  const event = JSON.parse(await readFile(sourcePath, 'utf8'))
  validateEvent(event, sourcePath)

  const outputPath = join(outputDir, basename(fixture))
  await writeFile(outputPath, `${JSON.stringify(event, null, 2)}\n`, 'utf8')
  exported.push(outputPath)
}

console.log(JSON.stringify({
  kind: 'NoeticaSourceOSInteractionArtifactExport',
  status: 'ok',
  outputDir,
  exported
}, null, 2))

function validateEvent(event, sourcePath) {
  const required = [
    'interactionEventId',
    'type',
    'specVersion',
    'eventClass',
    'occurredAt',
    'surface',
    'mode',
    'session',
    'actor',
    'payloadMode',
    'governanceTrace'
  ]

  for (const field of required) {
    if (!(field in event)) throw new Error(`${sourcePath}: missing ${field}`)
  }

  if (!event.interactionEventId.startsWith('urn:srcos:interaction-event:')) {
    throw new Error(`${sourcePath}: interactionEventId must be a SourceOS interaction URN`)
  }

  if (event.type !== 'SourceOSInteractionEvent') {
    throw new Error(`${sourcePath}: type must be SourceOSInteractionEvent`)
  }

  if (event.surface?.surfaceKind !== 'noetica') {
    throw new Error(`${sourcePath}: surface.surfaceKind must be noetica`)
  }

  if (!['metadata-only', 'summary', 'ref-only', 'inline-bounded', 'redacted'].includes(event.payloadMode)) {
    throw new Error(`${sourcePath}: unsupported payloadMode ${event.payloadMode}`)
  }

  if (event.payloadMode === 'summary' && typeof event.payload?.summary !== 'string') {
    throw new Error(`${sourcePath}: summary payload requires payload.summary`)
  }

  if (event.governanceTrace?.memoryWritten !== false && event.governanceTrace?.memoryWritten !== true) {
    throw new Error(`${sourcePath}: governanceTrace.memoryWritten must be boolean`)
  }
}
