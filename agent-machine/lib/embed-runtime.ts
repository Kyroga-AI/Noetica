/**
 * embed-runtime — Noetica's own local embedder (the noetica-embed Rust sidecar, fastembed/ONNX).
 *
 * This replaces ollama for vectorization: embeddings are a thing we need over and over and
 * deterministically, so we run our OWN embedder, not the generative model server. The sidecar
 * is lazy-spawned on first use and proxied over HTTP; batch calls embed hundreds of strings in
 * a single request (~ms warm). Falls back to null if the binary isn't present (callers degrade).
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const PORT = 8126
const BASE = `http://127.0.0.1:${PORT}`
let child: ChildProcess | null = null

function binaryPath(): string | null {
  // prod: shipped next to the agent-machine binary in the .app (Tauri externalBin)
  const beside = path.join(path.dirname(process.execPath), 'noetica-embed')
  if (fs.existsSync(beside)) return beside
  // dev: the cargo target
  const here = path.dirname(fileURLToPath(import.meta.url))
  for (const p of [
    path.resolve(process.cwd(), 'embed-sidecar/target/release/noetica-embed'),
    path.resolve(here, '../../embed-sidecar/target/release/noetica-embed'),
  ]) { if (fs.existsSync(p)) return p }
  return null
}

async function healthy(): Promise<boolean> {
  try { const r = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(1200) }); return r.ok } catch { return false }
}

let starting: Promise<boolean> | null = null
async function ensure(): Promise<boolean> {
  if (await healthy()) return true
  if (starting) return starting
  starting = (async () => {
    const bin = binaryPath()
    if (!bin) return false
    if (!child || child.exitCode !== null) {
      child = spawn(bin, [], { env: { ...process.env, NOETICA_EMBED_PORT: String(PORT) }, stdio: 'ignore', detached: false })
      child.on('exit', () => { child = null })
    }
    const deadline = Date.now() + 6000
    while (Date.now() < deadline) { if (await healthy()) return true; await new Promise((r) => setTimeout(r, 300)) }
    return false
  })().finally(() => { starting = null })
  return starting
}

export function isLocalEmbedAvailable(): boolean { return binaryPath() !== null }

/** Batch-embed texts with our own embedder. Returns null per item that failed, or null overall
 *  if the sidecar is unavailable (caller falls back to degree-rank / ollama as appropriate). */
export async function embedBatchLocal(texts: string[]): Promise<(number[] | null)[] | null> {
  if (texts.length === 0) return []
  if (!(await ensure())) return null
  try {
    const r = await fetch(`${BASE}/embed`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ texts }), signal: AbortSignal.timeout(60_000),
    })
    if (!r.ok) return null
    const j = (await r.json()) as { vectors?: number[][] }
    const vecs = j.vectors ?? []
    return texts.map((_, i) => (Array.isArray(vecs[i]) && vecs[i]!.length ? vecs[i]! : null))
  } catch { return null }
}
