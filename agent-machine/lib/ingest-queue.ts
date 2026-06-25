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
}

const jobs = new Map<string, IngestJob>()
const pending: Array<{ id: string; mimeType: string; buf: Buffer }> = []
let processing = false

/** Enqueue a document for background ingestion. Returns the job immediately (status 'queued'). */
export function enqueueIngest(filename: string, mimeType: string, buf: Buffer): IngestJob {
  const id = randomUUID()
  const job: IngestJob = { id, filename, status: 'queued', bytes: buf.length, queuedAt: Date.now() }
  jobs.set(id, job)
  pending.push({ id, mimeType, buf })
  void drain()
  return job
}

/** Unpack a ZIP and enqueue each document-type entry as its own background job. Skips directories, macOS
 *  resource forks (__MACOSX), hidden/dotfiles, and non-document files (so an 8MB zip of 100 pages fans out
 *  into per-file jobs instead of being parsed as one blob of binary garbage — the current .zip failure mode). */
export function enqueueArchive(zipName: string, buf: Buffer): { archive: string; enqueued: IngestJob[]; skipped: string[] } {
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(new Uint8Array(buf))
  } catch (e) {
    throw new Error(`could not read zip "${zipName}": ${(e instanceof Error ? e.message : String(e)).slice(0, 120)}`)
  }
  const enqueued: IngestJob[] = []
  const skipped: string[] = []
  for (const [p, data] of Object.entries(files)) {
    const base = p.split('/').pop() || p
    if (p.endsWith('/') || data.length === 0) continue                       // directory entry
    if (p.startsWith('__MACOSX/') || base.startsWith('.')) continue          // mac resource forks / hidden
    if (!INGESTIBLE.test(base)) { skipped.push(p); continue }                // image/binary/media → skip
    // Namespace the job filename under the archive so the graph/table shows provenance (zip → file).
    enqueued.push(enqueueIngest(`${zipName.replace(/\.zip$/i, '')}/${p}`, '', Buffer.from(data)))
  }
  return { archive: zipName, enqueued, skipped }
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
      } catch (e) {
        job.status = 'failed'
        job.error = (e instanceof Error ? e.message : String(e)).replace(/[\r\n]+/g, ' ').slice(0, 300)
        job.doneAt = Date.now()
        console.error(`[ingest-queue] FAILED ${job.filename}: ${job.error}`.replace(/[\r\n]/g, ' '))
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
