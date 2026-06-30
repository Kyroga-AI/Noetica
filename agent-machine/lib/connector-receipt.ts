/**
 * connector-receipt — the Onyx kill: OPEN, tamper-evident, cryptographically-scoped
 * ingestion audit. Onyx advertises 50+ connectors with permission-sync but paywalls its
 * audit + governance behind Enterprise. We make it the DEFAULT and OPEN: every connector /
 * ingest run emits a `ConnectorReceipt` that is
 *   • spec-conformant — field names conform to sourceos-spec Connector.json /
 *     ConnectorActionScope.json (connectorKind enum, actionScope verbs, URN ids);
 *   • scoped to a SOVEREIGN SEAT — `seatRef` is the seat's PUBLIC pseudonym (did:key) /
 *     scope alias from sovereign-id, NEVER the private key;
 *   • tamper-evident + sealable — written to the SAME evidence sink and `sealable`
 *     structure as reasoning-evidence receipts, so `turtle-seal` / agentplane can seal it
 *     exactly like a ReasoningReceipt;
 *   • SAFE-TRACE — `contentHash` is sha256 over an ingest MANIFEST (filenames + sizes),
 *     NEVER raw document content. No bytes of ingested content ever land in the receipt.
 *
 * Every function is exception-safe: an evidence failure must NEVER break ingestion.
 *
 * Authority: /Users/michaelheller/dev/sourceos-spec/schemas/{Connector,ConnectorActionScope}.json
 * Dependency-light: node crypto + fs only.
 */
import { createHash, randomBytes } from 'node:crypto'
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { TrustLevel } from './reasoning-evidence.js'

const SPEC_VERSION = '2.0.0'
const RECEIPT_PREFIX = 'urn:srcos:receipt:connector:'

/** ConnectorKind — a subset of the ConnectorActionScope.json `connectorKind` enum that
 *  Noetica ingestion actually exercises, plus composio-* tool variants. */
export type ConnectorKind =
  | 'filesystem' | 'github' | 'gitlab' | 'drive' | 'httpApi' | 'custom'
  | `composio-${string}`

/** ActionScope — the action class for this ingest run. Reads map to readOnly; writing
 *  documents into a collection index is a scopedWrite (`actionScope: 'ingest'`). */
export type ActionScope = 'read' | 'ingest'

export type ConnectorReceiptStatus = 'completed' | 'failed' | 'partial'

/** One entry in the safe ingest manifest: filename + size only — never content. */
export interface ManifestEntry { filename: string; bytes: number }

export interface ConnectorReceipt {
  id: string
  type: 'ConnectorReceipt'
  specVersion: string
  /** Connector class — conforms to ConnectorActionScope.json connectorKind family. */
  connectorKind: string
  /** Action verb scope for this run — read | ingest. */
  actionScope: ActionScope
  /** The collection (graph scope) this run wrote into. */
  collectionRef: string
  /** The sovereign seat's PUBLIC pseudonym / alias — never the private key. */
  seatRef: string
  /** The source's TrustLevel in the 5-level taxonomy. */
  trustLevel: TrustLevel
  docCount: number
  bytes: number
  status: ConnectorReceiptStatus
  /** sha256 over the ingest manifest (filenames+sizes) — "sha256:…"; safe-trace. */
  contentHash: string
  /** Sealable by turtle-seal / agentplane, exactly like a ReasoningReceipt. */
  sealable: true
  capturedAt: string
  [k: string]: unknown
}

function sink(): string {
  return process.env.SOURCEOS_REASONING_EVIDENCE || join(homedir(), '.noetica', 'reasoning')
}
/** Streaming append log — mirrors reasoning-events.ndjson so a sealer sees one stream. */
function connectorLog(): string { return join(sink(), 'connector-receipts.ndjson') }
function hex(bytes = 16): string { return randomBytes(bytes).toString('hex') }
function sha256(s: string): string { return createHash('sha256').update(s).digest('hex') }
function nowIso(): string { return new Date().toISOString() }

/** Build the SAFE content hash: sha256 over a canonical manifest of (filename, bytes) —
 *  NEVER raw content. Deterministic ordering so the hash is stable + verifiable. */
export function manifestHash(manifest: ManifestEntry[]): string {
  const canonical = (manifest ?? [])
    .map((m) => `${String(m?.filename ?? '')}:${Number(m?.bytes ?? 0)}`)
    .sort()
    .join('\n')
  return 'sha256:' + sha256(canonical)
}

/**
 * Emit a spec-conformant, sealable ConnectorReceipt and write it to the evidence sink
 * (a per-receipt receipt.json under <sink>/connector/<hex>/ AND an append to the streaming
 * NDJSON log — mirroring reasoning-evidence's persistence so agentplane can seal it).
 *
 * Safe-trace: `contentHash` is derived from the manifest (filenames+sizes), and the manifest
 * is NOT persisted into the receipt — only its hash. Exception-safe: returns the receipt even
 * if the disk write fails (so callers can still cite it), and never throws.
 */
export function emitConnectorReceipt(args: {
  connectorKind: ConnectorKind | string
  actionScope: ActionScope
  collectionRef: string
  seatRef: string
  trustLevel: TrustLevel
  manifest: ManifestEntry[]
  status: ConnectorReceiptStatus
  /** Optional total bytes override; else summed from the manifest. */
  bytes?: number
}): ConnectorReceipt {
  const manifest = Array.isArray(args.manifest) ? args.manifest : []
  const docCount = manifest.length
  const bytes = typeof args.bytes === 'number' && Number.isFinite(args.bytes)
    ? args.bytes
    : manifest.reduce((s, m) => s + (Number(m?.bytes) || 0), 0)
  const receiptHex = hex()
  const receipt: ConnectorReceipt = {
    id: RECEIPT_PREFIX + receiptHex,
    type: 'ConnectorReceipt',
    specVersion: SPEC_VERSION,
    connectorKind: String(args.connectorKind ?? 'custom'),
    actionScope: args.actionScope === 'read' ? 'read' : 'ingest',
    collectionRef: String(args.collectionRef ?? ''),
    seatRef: String(args.seatRef ?? ''),
    trustLevel: args.trustLevel,
    docCount,
    bytes,
    status: args.status,
    contentHash: manifestHash(manifest),
    sealable: true,
    capturedAt: nowIso(),
  }
  try {
    const dir = join(sink(), 'connector', receiptHex)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'receipt.json'), JSON.stringify(receipt, null, 2))
    mkdirSync(sink(), { recursive: true })
    appendFileSync(connectorLog(), JSON.stringify(receipt) + '\n')
  } catch (err) {
    console.warn('[connector-receipt] emitConnectorReceipt write failed:', err instanceof Error ? err.message : String(err))
  }
  return receipt
}
