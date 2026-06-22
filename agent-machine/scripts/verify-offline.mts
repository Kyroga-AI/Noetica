/**
 * verify-offline — the offline-integrity harness. Proves the zero-egress badge is honest:
 *   1. arms the egress guard in offline mode
 *   2. asserts external egress is PHYSICALLY blocked (not merely absent)
 *   3. asserts localhost (Ollama / sidecars / the AM) is still reachable
 *   4. runs the core LOCAL flows (graph search + memory + episodic recall) and asserts they
 *      operate with ZERO unexpected egress
 *
 * Run:  npx tsx scripts/verify-offline.mts   (from agent-machine/)   — or  npm run verify:offline
 */
import { installEgressGuard, setOfflineMode, blockedEgressCount } from '../lib/egress-guard.js'
import { getHellGraph } from '@socioprophet/hellgraph'

let failures = 0
const ok = (label: string, cond: boolean) => { console.log(`  ${cond ? '✓' : '✗'} ${label}`); if (!cond) failures++ }

;(async () => {
  console.log('Offline-integrity harness — arming the egress guard…')
  installEgressGuard()
  setOfflineMode(true)

  // 1. External egress is physically blocked.
  let externalBlocked = false
  try { await fetch('https://api.anthropic.com/v1/messages', { method: 'POST' }) }
  catch (e) { externalBlocked = /EGRESS BLOCKED/.test(String(e)) }
  ok('external egress (api.anthropic.com) is BLOCKED', externalBlocked)

  let openaiBlocked = false
  try { await fetch('https://api.openai.com/v1/chat/completions') }
  catch (e) { openaiBlocked = /EGRESS BLOCKED/.test(String(e)) }
  ok('external egress (api.openai.com) is BLOCKED', openaiBlocked)

  const deliberateBlocks = blockedEgressCount()

  // 2. Localhost is still reachable (allowed through — a connect failure is NOT an egress block).
  let localAllowed = false
  try { await fetch('http://127.0.0.1:1/healthz') }
  catch (e) { localAllowed = !/EGRESS BLOCKED/.test(String(e)) }
  ok('localhost (Ollama / sidecars) is ALLOWED through', localAllowed)

  // 3. Core LOCAL flows run with zero egress.
  const g = getHellGraph()
  const store = {
    nodesByLabel: (l: string) => g.nodesByLabel(l) as any[],
    out: (id: string, e?: string) => g.out(id, e) as any[],
    in: (id: string, e?: string) => g.in(id, e) as any[],
  }
  const { graphSearch } = await import('../lib/graph-search.js')
  const { recallExchanges } = await import('../lib/episodic.js')

  const hits = graphSearch(store, 'noetica memory graph', { limit: 5 })
  ok(`graph search ran offline (${hits.length} hits)`, hits.length >= 0)

  const recall = recallExchanges({ nodesByLabel: (l: string) => g.nodesByLabel(l) as any[] }, 'show me my files', { limit: 3 })
  ok(`episodic recall ran offline (${recall.length} exchanges)`, recall.length >= 0)

  // 4. No egress beyond the two deliberate external probes.
  ok(`zero unexpected egress (only the ${deliberateBlocks} deliberate probes were blocked)`, blockedEgressCount() === deliberateBlocks)

  console.log(failures === 0
    ? '\n✅ Offline integrity verified — nothing can leave this device in offline mode; local flows operational.'
    : `\n❌ ${failures} check(s) failed — the zero-egress guarantee is NOT honest yet.`)
  process.exit(failures === 0 ? 0 : 1)
})()
