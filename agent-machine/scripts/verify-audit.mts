/**
 * verify-audit — proves the governance audit is tamper-evident. The procurement demo:
 *   1. loads (or creates) the device Ed25519 audit key
 *   2. hash-chains the real governance ring + signs the chain head
 *   3. verifies the chain + the device signature  → intact & attested
 *   4. EDITS one record (hides an egress) and shows the chain breaks at a detectable index
 *
 * Run:  npx tsx scripts/verify-audit.mts   (from agent-machine/)   — or  npm run verify:audit
 */
import { loadOrCreateDeviceKey } from '../lib/audit-key.js'
import { buildChain, chainHead, signHead, verifyHead, verifyChain, type AuditRecord } from '../lib/audit-chain.js'

const AM = `http://127.0.0.1:${process.env['NOETICA_AM_PORT'] ?? '8080'}`

let failures = 0
const ok = (label: string, cond: boolean) => { console.log(`  ${cond ? '✓' : '✗'} ${label}`); if (!cond) failures++ }

async function loadRuns(): Promise<AuditRecord[]> {
  try {
    const r = await fetch(`${AM}/api/governance/recent?limit=500`, { signal: AbortSignal.timeout(3000) })
    if (r.ok) { const d = await r.json() as { runs?: AuditRecord[] }; if (d.runs?.length) return d.runs }
  } catch { /* AM not up — use a demo ring so the proof still runs */ }
  return [
    { run_id: 'r1', provider: 'ollama', model_routed: 'qwen2.5-coder', tokens_egressed: 0, timestamp: '2026-06-21T10:00:00Z' },
    { run_id: 'r2', provider: 'anthropic', model_routed: 'claude-opus', tokens_egressed: 1200, timestamp: '2026-06-21T11:00:00Z' },
    { run_id: 'r3', provider: 'ollama', model_routed: 'qwen2.5', tokens_egressed: 0, timestamp: '2026-06-21T12:00:00Z' },
  ]
}

;(async () => {
  console.log('Tamper-evident audit — attesting the governance ring…')
  const key = loadOrCreateDeviceKey()
  const runs = await loadRuns()
  console.log(`  device key ${key.fingerprint} · ${runs.length} governance records`)

  // Attest: hash-chain + sign the head.
  const chain = buildChain(runs)
  const head = chainHead(chain)
  const signature = signHead(head, key.privateKey)

  // Verify the attestation as an auditor would.
  ok('hash-chain is intact', verifyChain(runs, chain).valid)
  ok('chain head is Ed25519-signed by this device', verifyHead(head, signature, key.publicKey))

  // Adversary: edit a record (prefer hiding a real egress; else forge any record). The _forged
  // marker guarantees the canonical form changes even if the faked fields already matched.
  const egressIdx = runs.findIndex((r) => Number(r['tokens_egressed'] ?? 0) > 0)
  const target = egressIdx >= 0 ? egressIdx : Math.min(1, runs.length - 1)
  const tampered = runs.map((r, i) => (i === target ? { ...r, tokens_egressed: 0, provider: 'ollama', _forged: true } : r))
  const vt = verifyChain(tampered, chain)
  const what = egressIdx >= 0 ? `hiding egress at #${target}` : `forging record #${target}`
  ok(`a tampered record (${what}) is DETECTED`, !vt.valid && vt.brokenAt === target)

  console.log(`\n  attestation: head=${head.slice(0, 24)}… sig=${signature.slice(0, 16)}… by device ${key.fingerprint}`)
  console.log(failures === 0
    ? '\n✅ Audit is tamper-evident — every record is hash-chained and the head is device-signed; any alteration is provable.'
    : `\n❌ ${failures} check(s) failed — the audit is NOT verifiably tamper-evident yet.`)
  process.exit(failures === 0 ? 0 : 1)
})()
