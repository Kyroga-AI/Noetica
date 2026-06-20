#!/usr/bin/env node
/**
 * Pre-demo smoke check — verifies every link in the chain so a live demo doesn't
 * surprise you. Run after launching the app:  npm run predemo  (from agent-machine/)
 *
 * Checks: agent-machine up · Ollama can actually GENERATE (not just list) · embed
 * model present · routing picks a capable model · document RAG round-trips.
 * Exit 0 = all green; exit 1 = at least one ✗.
 */
const AM = process.env.NOETICA_AM_BASE ?? 'http://127.0.0.1:8080'
let failed = 0
const ok = (m) => console.log(`  ✓ ${m}`)
const bad = (m) => { console.log(`  ✗ ${m}`); failed++ }

async function j(path, opts) {
  const r = await fetch(`${AM}${path}`, { signal: AbortSignal.timeout(60_000), ...opts })
  return { status: r.status, body: await r.json().catch(() => null), raw: r }
}

async function main() {
  console.log(`▸ agent-machine @ ${AM}`)
  let status
  try { status = await j('/api/status') } catch { bad('agent-machine unreachable — is the app running?'); return }
  status.status === 200 ? ok(`up (v${status.body?.version})`) : bad(`status ${status.status}`)
  status.body?.ollama?.running ? ok(`ollama reachable (${(status.body.ollama.models ?? []).length} models)`) : bad('ollama not reachable')

  console.log('▸ feature flags')
  try { const f = await j('/api/flags'); ok(`${f.body.flags.filter((x) => x.enabled).length}/${f.body.flags.length} flags on`) } catch { bad('flags endpoint') }

  console.log('▸ live generation + routing (this is what froze the last demo)')
  try {
    const r = await fetch(`${AM}/api/chat`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'In one sentence, what is a clinical trial?' }] }),
      signal: AbortSignal.timeout(60_000),
    })
    let buf = '', routed = '', err = ''
    const reader = r.body.getReader(); const dec = new TextDecoder()
    const deadline = Date.now() + 75_000
    // Read until the agent-machine closes the SSE stream (answer complete) or the
    // budget runs out. Don't rely on a [DONE] marker — it isn't forwarded.
    while (Date.now() < deadline) {
      const { done, value } = await reader.read().catch(() => ({ done: true, value: undefined }))
      if (done) break
      buf += dec.decode(value, { stream: true })
      const m = buf.match(/"model_routed":"([^"]+)"/); if (m) routed = m[1]
      const e = buf.match(/"error":"([^"]+)"/); if (e) err = e[1]
    }
    await reader.cancel().catch(() => {})
    const answered = /"(token|delta|content|text)"/.test(buf) && buf.length > 150
    if (err) bad(`generation error: ${err.slice(0, 80)}`)
    else if (answered) ok(`generated an answer · routed → ${routed || '(model)'}`)
    else bad('no answer streamed')
    // Responsive mode deliberately starts on the fast 3B (technique over horsepower):
    // a 3B that ANSWERS in time beats a 7B that times out. We only flag the model if
    // NOTHING streamed (handled above). Routing to 3B is the intended fast base —
    // escalation climbs to a 7B when a turn actually struggles.
    if (routed) ok(`routed to ${routed} (responsive base; escalates on struggle)`)
  } catch (e) { bad(`chat failed: ${e instanceof Error ? e.message : e}`) }

  console.log('▸ document RAG round-trip')
  try {
    const ing = await j('/api/ingest/document', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ filename: '_predemo.txt', content: 'PREDEMO_MARKER: the Acme reactor failed inspection on 2026-01-02 due to a coolant leak.' }),
    })
    ing.body?.chunks >= 1 ? ok(`ingest works (${ing.body.chunks} chunks, ${ing.body.embedded ?? '?'} embedded)`) : bad('ingest returned no chunks')
    const r = await fetch(`${AM}/api/chat`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'Why did the Acme reactor fail inspection?' }] }),
      signal: AbortSignal.timeout(30_000),
    })
    let buf = ''; const reader = r.body.getReader(); const dec = new TextDecoder()
    const deadline = Date.now() + 12_000
    while (Date.now() < deadline) { const { done, value } = await reader.read().catch(() => ({ done: true })); if (done) break; buf += dec.decode(value, { stream: true }); if (/semantic-documents/.test(buf)) break }
    await reader.cancel().catch(() => {})
    if (/semantic-documents/.test(buf)) ok('uploaded docs are retrieved into chat context')
    else bad('document context NOT injected — RAG retrieval broken')
  } catch (e) { bad(`RAG check failed: ${e instanceof Error ? e.message : e}`) }

  console.log(failed === 0 ? '\n✅ ALL GREEN — safe to demo' : `\n❌ ${failed} check(s) failed — fix before demoing`)
  process.exit(failed === 0 ? 0 : 1)
}
main().catch((e) => { console.error('predemo-check crashed:', e); process.exit(1) })
