import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { TurnRiskTrace } from '@/lib/risk/riskAversion'

const DEVELOPMENT_RUNTIME_RISK_TRACE_DIR = '.noetica/risk-aversion/runtime-traces'

export type RiskTraceArtifactRef = {
  traceRef: string
  outputPath: string
  traceHash: string
}

export async function writeRuntimeRiskTraceArtifact(trace: TurnRiskTrace): Promise<RiskTraceArtifactRef> {
  const outputDir = process.env.NOETICA_RUNTIME_RISK_TRACE_DIR ?? DEVELOPMENT_RUNTIME_RISK_TRACE_DIR
  const traceRef = `urn:noetica:risk-trace:${safeSlug(trace.turnId)}`
  const filename = `${safeSlug(trace.turnId)}.risk-trace.json`
  const outputPath = join(outputDir, filename)
  const serialized = `${JSON.stringify(trace, null, 2)}\n`
  const traceHash = `sha256:${createHash('sha256').update(serialized).digest('hex')}`

  await mkdir(outputDir, { recursive: true })
  await writeFile(outputPath, serialized, 'utf8')

  return { traceRef, outputPath, traceHash }
}

function safeSlug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9._:-]+/g, '-').replace(/^-+|-+$/g, '') || 'trace'
}
