'use client'

// Append-only client-side evidence ledger.
// Persists governance events across sessions via IndexedDB (localStorage fallback).
// Max 2000 entries — oldest trimmed when full.

export interface LedgerEntry {
  id: string
  timestamp: string
  session_id: string
  kind: 'chat_request' | 'tool_call' | 'policy_check' | 'memory_read' | 'memory_write' | 'session_init' | 'error' | 'benchmark_result'
  model_id: string
  provider: string
  latency_ms: number
  input_tokens?: number
  output_tokens?: number
  /** Estimated USD cost for this run (0 for local providers). */
  cost_usd?: number
  /** Tokens that left the device (0 for local — full sovereignty). */
  tokens_egressed?: number
  request_hash?: string
  evidence_hash?: string
  content_preview: string
  memory_scope?: string
  policy_admitted?: boolean
  policy_profile?: string
  // ── benchmark_result fields (populated by EvaluateSurface) ──
  /** Benchmark task id, e.g. "reasoning", "code" */
  task_id?: string
  /** LLM-as-judge score 0..1 */
  judge_score?: number
  /** Optional judge label/verdict */
  judge_label?: string
}

const DB_NAME = 'noetica-evidence'
const STORE_NAME = 'ledger'
const MAX_ENTRIES = 2000
const LS_KEY = 'noetica:evidence-ledger'

// ── IndexedDB helpers ──────────────────────────────────────────────────────────

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' })
        store.createIndex('timestamp', 'timestamp', { unique: false })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function idbAppend(entry: LedgerEntry): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).put(entry)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

async function idbRead(limit = MAX_ENTRIES): Promise<LedgerEntry[]> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const req = tx.objectStore(STORE_NAME).index('timestamp').getAll()
    req.onsuccess = () => {
      const all: LedgerEntry[] = req.result ?? []
      resolve(all.sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, limit))
    }
    req.onerror = () => reject(req.error)
  })
}

async function idbTrim(): Promise<void> {
  const db = await openDB()
  const entries = await idbRead(MAX_ENTRIES * 2)
  if (entries.length <= MAX_ENTRIES) return
  const toDelete = entries.slice(MAX_ENTRIES)
  const tx = db.transaction(STORE_NAME, 'readwrite')
  for (const e of toDelete) tx.objectStore(STORE_NAME).delete(e.id)
}

async function idbClear(): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).clear()
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

// ── localStorage fallback ──────────────────────────────────────────────────────

function lsRead(): LedgerEntry[] {
  try {
    const raw = localStorage.getItem(LS_KEY)
    return raw ? (JSON.parse(raw) as LedgerEntry[]) : []
  } catch { return [] }
}

function lsWrite(entries: LedgerEntry[]): void {
  try { localStorage.setItem(LS_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES))) } catch {}
}

// ── Public API ─────────────────────────────────────────────────────────────────

function canUseIDB(): boolean {
  return typeof indexedDB !== 'undefined'
}

export async function appendLedgerEntry(entry: LedgerEntry): Promise<void> {
  if (canUseIDB()) {
    await idbAppend(entry)
    await idbTrim()
  } else {
    const entries = lsRead()
    lsWrite([entry, ...entries])
  }
}

export async function readLedgerEntries(limit = 200): Promise<LedgerEntry[]> {
  if (canUseIDB()) {
    return idbRead(limit)
  }
  return lsRead().slice(0, limit)
}

export async function clearLedger(): Promise<void> {
  if (canUseIDB()) {
    await idbClear()
  } else {
    lsWrite([])
  }
}
