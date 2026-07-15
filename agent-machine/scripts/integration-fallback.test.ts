/**
 * Permanent regression guard for the demo-saving Ollama fallback.
 *
 * Spins up TWO mock Ollamas — a broken primary (lists models, 500s on generation
 * with the "llama-server binary not found" error) and a working fallback (streams
 * an OpenAI-compatible completion) — boots the agent-machine pointed at both, and
 * asserts a chat request falls back and streams the fallback's answer. Fully
 * hermetic: no real Ollama required. This is the exact failure that froze the demo.
 *
 * Run: npm run test:integration:fallback
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import * as http from 'node:http'
import { spawn, type ChildProcess } from 'node:child_process'

const AM_PORT = 8101
const PRIMARY_PORT = 8102
const FALLBACK_PORT = 8103
const ANSWER = 'FALLBACK_ANSWER_OK'
const BASE = `http://127.0.0.1:${AM_PORT}`

let server: ChildProcess
let primary: http.Server
let fallback: http.Server

const TAGS = JSON.stringify({ models: [{ name: 'qwen2.5:7b' }, { name: 'llama3.2:3b' }] })

function startPrimary(): Promise<void> {
  primary = http.createServer((req, res) => {
    if (req.url?.startsWith('/api/tags')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end(TAGS); return }
    if (req.url?.startsWith('/api/show')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"model_info":{}}'); return }
    // Generation fails like a bundled Ollama missing its runner.
    res.writeHead(500, { 'content-type': 'application/json' })
    res.end('{"error":{"message":"error starting llama-server: llama-server binary not found"}}')
  })
  // Fail FAST if the port is held (e.g. an orphaned run) — without the error handler a failed listen
  // never fires its callback and the `before` hook hangs forever instead of erroring.
  return new Promise((resolve, reject) => {
    primary.once('error', reject)
    primary.listen(PRIMARY_PORT, '127.0.0.1', () => resolve())
  })
}

function startFallback(): Promise<void> {
  fallback = http.createServer((req, res) => {
    if (req.url?.startsWith('/api/tags')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end(TAGS); return }
    if (req.url?.startsWith('/api/show')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"model_info":{}}'); return }
    // Valid OpenAI-compatible streaming completion.
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { role: 'assistant' } }] })}\n\n`)
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: ANSWER } }] })}\n\n`)
    res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`)
    res.write('data: [DONE]\n\n')
    res.end()
  })
  return new Promise((resolve, reject) => {
    fallback.once('error', reject)
    fallback.listen(FALLBACK_PORT, '127.0.0.1', () => resolve())
  })
}

before(async () => {
  await Promise.all([startPrimary(), startFallback()])
  server = spawn('node', ['--import', 'tsx', 'server.ts'], {
    cwd: new URL('..', import.meta.url).pathname,
    env: {
      ...process.env, NODE_ENV: 'test', NOETICA_AM_PORT: String(AM_PORT),
      OLLAMA_HOST: `http://127.0.0.1:${PRIMARY_PORT}`,
      OLLAMA_FALLBACK_HOST: `http://127.0.0.1:${FALLBACK_PORT}`,
      // These are functional route tests (no Origin header), not CSRF tests, so disable the drive-by
      // origin guard exactly like scripts/integration.test.ts / integration-rocks.test.ts do — otherwise
      // its no-Origin mutating POSTs are 403'd. (Guard logic is covered by lib/origin-guard.test.ts.)
      NOETICA_ORIGIN_GUARD: '0',
    },
    stdio: 'ignore',
  })
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    try { const r = await fetch(`${BASE}/api/status`, { signal: AbortSignal.timeout(1500) }); if (r.ok) return } catch { /* wait */ }
    await new Promise((res) => setTimeout(res, 500))
  }
  throw new Error('agent-machine did not start')
})

after(() => {
  server?.kill('SIGKILL')
  primary?.close()
  fallback?.close()
})

test('broken primary Ollama → chat falls back and streams the answer', async () => {
  const r = await fetch(`${BASE}/api/chat`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    // The prompt must route to MODEL GENERATION on a COLD first turn — that's what exercises the broken-primary
    // → fallback path this test guards. Two routes answer WITHOUT a model and must be avoided: a greeting
    // ("hello there") hits the deterministic small-talk layer, and ANY no-cue general question ("what is the
    // capital of France?") trips the concierge's cold-turn clarify (dialogue-policy: score 0 + ≥3 words). An
    // "Explain …" prompt matches the explain_teach intent cue (score > 0) → bypasses clarify → reasoning model
    // → broken primary → fallback streams the answer.
    body: JSON.stringify({ messages: [{ role: 'user', content: 'Explain how photosynthesis works in one sentence.' }] }),
    // 30s, not 15s: CI observed a 15.57s round-trip (just over the old 15s budget) as the
    // codebase has grown — the primary/fallback logic itself is unchanged (verified against
    // main), this is cold-start + shared-runner variance, same class of flake test 2 below
    // already documents and defends against with its own poll+deadline.
    signal: AbortSignal.timeout(30_000),
  })
  const text = await r.text()
  assert.ok(text.includes(ANSWER), `fallback answer should appear in the stream; got:\n${text.slice(0, 400)}`)
})

test('RAG: ingested document surfaces as hybrid-rerank-documents in chat', async () => {
  // Mock Ollama lets the chat proceed past the availability gate to retrieval.
  const ing = await fetch(`${BASE}/api/ingest/document`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ filename: 'baxter.txt', content: 'The Baxter facility shut down after Hurricane Helene flooding in September 2024.' }),
  })
  assert.equal(ing.status, 200)
  // Embedding + indexing the freshly-ingested doc is async, so semantic retrieval can race the chat
  // request under CI load (the source of the flake). Poll the chat until the doc is indexed and
  // injected, or a deadline — same assertion, but robust to the indexing race instead of one shot.
  let text = ''
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const r = await fetch(`${BASE}/api/chat`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'What caused the Baxter facility shutdown?' }] }),
      signal: AbortSignal.timeout(20_000),
    })
    text = await r.text()
    if (text.includes('hybrid-rerank-documents')) break
    await new Promise((res) => setTimeout(res, 1000))
  }
  assert.ok(text.includes('hybrid-rerank-documents'), `chat should inject the ingested doc as hybrid-rerank-documents; got:\n${text.slice(0, 400)}`)
})
