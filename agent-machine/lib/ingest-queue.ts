/**
 * ingest-queue — non-blocking, background document ingestion.
 *
 * Uploading a batch of docs must NOT make the user wait while each one parses + chunks + embeds + grounds into
 * the graph (a 33-chunk PDF can take many seconds on the local embedder). Instead, each upload is ENQUEUED and
 * returns immediately; a background worker drains the queue one doc at a time (serial — the embedder is the
 * bottleneck, so concurrency just causes contention), updating per-doc status. The UI polls /api/ingest/status
 * to render the queue/table and to show, in the graph, what's been parsed vs what's still pending.
 *
 * In-memory: jobs + their bytes live in process memory until done. Fine for interactive batches; a huge bulk
 * import would want a disk-backed spool, noted for later.
 */
import { randomUUID } from 'node:crypto'
import { unzipSync } from 'fflate'
import { collectionPath } from './doc-scope.js'
import { createCollection, ensureCollection, bumpDocCount, INBOX_ID } from './collections.js'
import { emitConnectorReceipt, type ManifestEntry } from './connector-receipt.js'
import { currentSeat, seatCanAccess, type Seat } from './seat-scope.js'
import type { TrustLevel } from './reasoning-evidence.js'

// Default trust for locally-uploaded documents: a workspace source the operator chose to
// ingest. Callers can override per-enqueue. This keeps the 5-level taxonomy on every receipt.
const DEFAULT_INGEST_TRUST: TrustLevel = 'trusted-workspace-source'

// Document types we ingest out of an archive. Everything else (images, binaries, media) is skipped, not parsed
// as UTF-8 garbage. .pdf/.docx have real extractors; the rest are read as text by extractText.
const INGESTIBLE = /\.(pdf|docx|md|markdown|txt|text|csv|tsv|json|html?|rtf|log|yml|yaml)$/i

export type IngestStatus = 'queued' | 'parsing' | 'ingesting' | 'done' | 'failed'

export interface IngestJob {
  id: string
  filename: string
  status: IngestStatus
  bytes: number
  chunks?: number
  entities?: number
  documentId?: string
  error?: string
  queuedAt: number
  startedAt?: number
  doneAt?: number
  /** Reason an enqueue was DENIED by the active seat's scope (governed-ingestion gate). */
  denied?: boolean
  reason?: string
}

// Per-job governance bookkeeping (collection / trust / seat) so the worker can emit a
// scoped ConnectorReceipt on done/failed without changing the public IngestJob shape.
interface JobGov {
  collectionId: string
  trustLevel: TrustLevel
  seatRef: string
  /** When set, the job belongs to a batch (archive) — the batch emits ONE receipt. */
  batchId?: string
}

const jobs = new Map<string, IngestJob>()
const jobGov = new Map<string, JobGov>()
const pending: Array<{ id: string; mimeType: string; buf: Buffer }> = []
let processing = false

/** Emit a per-job ConnectorReceipt for a single completed/failed ingest. Best-effort:
 *  an evidence failure must NEVER break ingestion. Skips jobs that belong to a batch
 *  (the batch emits its own aggregate receipt). */
function emitJobReceipt(job: IngestJob, status: 'completed' | 'failed'): void {
  try {
    const gov = jobGov.get(job.id)
    if (!gov || gov.batchId) return // batch jobs are covered by the batch receipt
    const manifest: ManifestEntry[] = [{ filename: job.filename, bytes: job.bytes }]
    emitConnectorReceipt({
      connectorKind: 'filesystem',
      actionScope: 'ingest',
      collectionRef: gov.collectionId,
      seatRef: gov.seatRef,
      trustLevel: gov.trustLevel,
      manifest,
      status,
      bytes: job.bytes,
    })
  } catch (e) {
    console.warn('[ingest-queue] emitJobReceipt failed (ingestion unaffected):', e instanceof Error ? e.message : String(e))
  } finally {
    jobGov.delete(job.id)
  }
}

/** Build a clean DENIED failed job (no crash) when the active seat is out of scope. */
function deniedJob(scoped: string, bytes: number, reason: string): IngestJob {
  const id = randomUUID()
  const job: IngestJob = {
    id, filename: scoped, status: 'failed', bytes,
    queuedAt: Date.now(), doneAt: Date.now(), denied: true, reason,
  }
  jobs.set(id, job)
  return job
}

/** Enqueue a document for background ingestion into a COLLECTION scope (default: the Inbox catch-all). The
 *  filename is namespaced `collection/<id>/…` so it never lands in core memory/knowledge/self. Returns the job
 *  immediately (status 'queued'). */
export function enqueueIngest(
  filename: string,
  mimeType: string,
  buf: Buffer,
  collectionId: string = INBOX_ID,
  opts?: { seat?: Seat; trustLevel?: TrustLevel; batchId?: string },
): IngestJob {
  ensureCollection(INBOX_ID, 'Inbox')
  const scoped = collectionPath(collectionId, filename)
  const trustLevel = opts?.trustLevel ?? DEFAULT_INGEST_TRUST
  // Governed ingestion gate: the active seat must be in scope for this collection + trust.
  // Owner seat (single-user default) → always allowed; out-of-scope scoped seat → clean
  // DENIED failed job (no crash, no queue entry). Resolving the seat is exception-safe.
  const seat = opts?.seat ?? currentSeat()
  if (!seatCanAccess(seat, collectionId, trustLevel)) {
    return deniedJob(
      scoped, buf.length,
      `seat ${seat.scopeId} is out of scope for collection "${collectionId}" at trust "${trustLevel}"`,
    )
  }
  const id = randomUUID()
  const job: IngestJob = { id, filename: scoped, status: 'queued', bytes: buf.length, queuedAt: Date.now() }
  jobs.set(id, job)
  jobGov.set(id, { collectionId, trustLevel, seatRef: seat.pseudonym, batchId: opts?.batchId })
  pending.push({ id, mimeType, buf })
  bumpDocCount(collectionId)
  void drain()
  return job
}

/** Unpack a ZIP and enqueue each document-type entry as its own background job. Skips directories, macOS
 *  resource forks (__MACOSX), hidden/dotfiles, and non-document files (so an 8MB zip of 100 pages fans out
 *  into per-file jobs instead of being parsed as one blob of binary garbage — the current .zip failure mode). */
export function enqueueArchive(zipName: string, buf: Buffer): { archive: string; collectionId: string; enqueued: IngestJob[]; skipped: string[] } {
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(new Uint8Array(buf))
  } catch (e) {
    throw new Error(`could not read zip "${zipName}": ${(e instanceof Error ? e.message : String(e)).slice(0, 120)}`)
  }
  // A ZIP = ONE named collection (its own graph scope) — kept out of core memory/knowledge.
  const collection = createCollection(zipName.replace(/\.zip$/i, ''), zipName)
  const trustLevel = DEFAULT_INGEST_TRUST
  // Governed ingestion gate (once for the batch): out-of-scope seat → DENY the whole archive
  // cleanly. Owner seat (single-user default) → always allowed.
  const seat = currentSeat()
  if (!seatCanAccess(seat, collection.id, trustLevel)) {
    const reason = `seat ${seat.scopeId} is out of scope for collection "${collection.id}" at trust "${trustLevel}"`
    const denied = deniedJob(collectionPath(collection.id, zipName), buf.length, reason)
    return { archive: zipName, collectionId: collection.id, enqueued: [denied], skipped: [] }
  }
  const batchId = randomUUID()
  const enqueued: IngestJob[] = []
  const skipped: string[] = []
  const manifest: ManifestEntry[] = []
  for (const [p, data] of Object.entries(files)) {
    const base = p.split('/').pop() || p
    if (p.endsWith('/') || data.length === 0) continue                       // directory entry
    if (p.startsWith('__MACOSX/') || base.startsWith('.')) continue          // mac resource forks / hidden
    if (!INGESTIBLE.test(base)) { skipped.push(p); continue }                // image/binary/media → skip
    enqueued.push(enqueueIngest(p, '', Buffer.from(data), collection.id, { seat, trustLevel, batchId })) // → collection/<id>/<path>
    manifest.push({ filename: collectionPath(collection.id, p), bytes: data.length })
  }
  // ONE aggregate ConnectorReceipt for the batch (docCount, total bytes, manifest hash).
  // Best-effort — an evidence failure must never break ingestion.
  try {
    emitConnectorReceipt({
      connectorKind: 'filesystem',
      actionScope: 'ingest',
      collectionRef: collection.id,
      seatRef: seat.pseudonym,
      trustLevel,
      manifest,
      status: enqueued.length > 0 ? 'completed' : 'partial',
    })
  } catch (e) {
    console.warn('[ingest-queue] archive ConnectorReceipt failed (ingestion unaffected):', e instanceof Error ? e.message : String(e))
  }
  return { archive: zipName, collectionId: collection.id, enqueued, skipped }
}

async function drain(): Promise<void> {
  if (processing) return
  processing = true
  try {
    while (pending.length > 0) {
      const next = pending.shift()!
      const job = jobs.get(next.id)
      if (!job) continue
      try {
        job.status = 'parsing'; job.startedAt = Date.now()
        const { extractText, ingestDocument } = await import('./doc-store.js')
        const text = await extractText(job.filename, next.mimeType, next.buf)
        if (!text.trim()) throw new Error('no extractable text in file (scanned image? try OCR)')
        job.status = 'ingesting'
        const r = await ingestDocument(job.filename, text)
        job.chunks = r.chunks; job.entities = r.entities; job.documentId = r.documentId
        job.status = 'done'; job.doneAt = Date.now()
        console.log(`[ingest-queue] done ${job.filename} (${r.chunks} chunks, ${r.entities} entities)`.replace(/[\r\n]/g, ' '))
        emitJobReceipt(job, 'completed')
      } catch (e) {
        job.status = 'failed'
        job.error = (e instanceof Error ? e.message : String(e)).replace(/[\r\n]+/g, ' ').slice(0, 300)
        job.doneAt = Date.now()
        console.error(`[ingest-queue] FAILED ${job.filename}: ${job.error}`.replace(/[\r\n]/g, ' '))
        emitJobReceipt(job, 'failed')
      }
    }
  } finally {
    processing = false
  }
}

/** All jobs, newest first — for the status table + the "parsed vs pending" graph overlay. */
export function ingestQueueStatus(): { jobs: IngestJob[]; summary: { queued: number; active: number; done: number; failed: number } } {
  const all = [...jobs.values()].sort((a, b) => b.queuedAt - a.queuedAt)
  const summary = {
    queued: all.filter((j) => j.status === 'queued').length,
    active: all.filter((j) => j.status === 'parsing' || j.status === 'ingesting').length,
    done: all.filter((j) => j.status === 'done').length,
    failed: all.filter((j) => j.status === 'failed').length,
  }
  return { jobs: all, summary }
}

/** Drop completed/failed jobs older than `keepMs` so the table doesn't grow unbounded. */
export function pruneIngestJobs(keepMs = 60 * 60 * 1000): void {
  const cutoff = Date.now() - keepMs
  for (const [id, j] of jobs) {
    if ((j.status === 'done' || j.status === 'failed') && (j.doneAt ?? 0) < cutoff) jobs.delete(id)
  }
}
