#!/usr/bin/env node
/**
 * cost-report — Today (Google Workspace + frontier LLM seats) vs Projected (sovereign prophet-workspace on GKE +
 * our own cloud choir + a thin BYOK fallback). Two comparisons, kept SEPARATE per the workspace/LLM split, plus a
 * combined total and a per-seat scaling curve (the crossover that actually makes the case).
 *
 * All prices are CONFIG at the top — replace ESTIMATE values with the actual bill lines and re-run:
 *   node scripts/cost-report.mjs
 *
 * Honesty note: at small scale the sovereign stack is NOT automatically cheaper — a 24/7 dedicated GPU is a real
 * fixed cost. The case is (1) flat-vs-per-seat scaling, (2) unlimited/uncapped vs metered+capped AU frontier,
 * (3) data sovereignty. The report shows all three rather than spinning a false "cheaper today".
 */

// ─────────────────────────── CONFIG (edit with real bill lines) ───────────────────────────
const C = {
  // — current seats (your actuals) —
  workspaceSeats: 6,            // Google Workspace Business Plus (May invoice: 6 seats)
  claudeSeats: 3,              // Claude Enterprise, AU
  chatgptSeats: 1,            // ChatGPT

  // — TODAY unit costs (USD/mo) —
  googleWorkspacePerSeat: 26.40,   // ACTUAL: $158.40 / 6 seats (Business Plus flexible)
  paSalesTax: 0.06,                // ACTUAL: 6% PA tax on the Google invoice
  claudeAuPerSeat: 40.00,          // ESTIMATE — AU is pricier + token-capped ("more than Pro"). Replace w/ bill.
  chatgptPerSeat: 20.00,           // ESTIMATE — ChatGPT Plus. Replace if Pro/Business.

  // — PROJECTED (sovereign, all on Google Cloud / GCP) USD/mo —
  gkeWorkspaceFixed: 142,          // prophet-workspace on GKE: e2-standard-4 (1yr CUD ~$62) + 500GB ~$60 + net ~$20; control plane $0 (free credit)
  gkeWorkspacePerExtra10Seats: 40, // bump a node tier roughly every ~10 seats (workspace is light)

  // cloud choir — 24/7 (no spot; agents can't be preempted). GCP g2-standard-8 (L4) = $0.85/hr on-demand.
  choirL4OnDemand: Math.round(0.85 * 730),        // ~$620/mo 24/7
  choirL4Cud1yr: Math.round(0.85 * 730 * 0.63),   // ~$390/mo 24/7 (1-yr CUD ~37% off)
  choirBilling: 'cud',                            // 'cud' (reliable 24/7) | 'ondemand'

  byokFallbackUsdPerMo: 40,        // thin metered US-API key for hard-reasoning escalations (NOT a seat)

  // — token economics (for the choir-vs-frontier break-even) —
  claudeOutputUsdPerMtok: 15,      // US Sonnet output $/Mtok; AU is higher (markup+GST) — frontier looks worse in AU
  agentTokensPerMonthM: 0,         // set to your measured 24/7 agent volume (millions/mo); 0 = unknown (skip)
}

const usd = (n) => '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 })
const choir = C.choirBilling === 'cud' ? C.choirL4Cud1yr : C.choirL4OnDemand

// ─────────────────────────── TODAY ───────────────────────────
const today = {
  workspace: C.workspaceSeats * C.googleWorkspacePerSeat * (1 + C.paSalesTax),
  claude: C.claudeSeats * C.claudeAuPerSeat,
  chatgpt: C.chatgptSeats * C.chatgptPerSeat,
}
today.total = today.workspace + today.claude + today.chatgpt

// ─────────────────────────── PROJECTED (sovereign) ───────────────────────────
const projected = {
  workspace: C.gkeWorkspaceFixed,
  choir,
  byok: C.byokFallbackUsdPerMo,
}
projected.total = projected.workspace + projected.choir + projected.byok

// ─────────────────────────── scaling curve ───────────────────────────
function todayAt(seats) {
  // frontier seats scale with team size (assume LLM seats ≈ workspace seats as the team standardizes on AI)
  const ws = seats * C.googleWorkspacePerSeat * (1 + C.paSalesTax)
  const llm = seats * (C.claudeAuPerSeat) // everyone on an AU Claude-class seat at scale
  return ws + llm
}
function projectedAt(seats) {
  const ws = C.gkeWorkspaceFixed + Math.floor(seats / 10) * C.gkeWorkspacePerExtra10Seats
  return ws + choir + C.byokFallbackUsdPerMo // choir + workspace ~flat; one GPU serves the team
}

// ─────────────────────────── output ───────────────────────────
const line = '─'.repeat(64)
console.log('\n' + line)
console.log('  SocioProphet — cost: TODAY vs PROJECTED (sovereign)   [USD/mo]')
console.log(line)

console.log('\n  TODAY  (Google + frontier seats)')
console.log(`    Google Workspace   ${C.workspaceSeats} seats   ${usd(today.workspace)}   (actual invoice)`)
console.log(`    Claude (AU)        ${C.claudeSeats} seats   ${usd(today.claude)}   (ESTIMATE — replace w/ bill)`)
console.log(`    ChatGPT            ${C.chatgptSeats} seat    ${usd(today.chatgpt)}   (ESTIMATE)`)
console.log(`    ${'TOTAL'.padEnd(28)} ${usd(today.total)} / mo   →   ${usd(today.total * 12)} / yr`)

console.log('\n  PROJECTED  (sovereign, all on Google Cloud)')
console.log(`    prophet-workspace (GKE)        ${usd(projected.workspace)}   (e2-standard-4 CUD + 500GB + net; control plane $0)`)
console.log(`    cloud choir 24/7 (L4, ${C.choirBilling})    ${usd(projected.choir)}   (unlimited inference, sovereign)`)
console.log(`    BYOK frontier fallback         ${usd(projected.byok)}   (metered US API for hard cases — not a seat)`)
console.log(`    ${'TOTAL'.padEnd(28)} ${usd(projected.total)} / mo   →   ${usd(projected.total * 12)} / yr`)

const delta = projected.total - today.total
console.log('\n  ' + line.slice(2))
console.log(`  At ${C.workspaceSeats} seats: projected is ${delta >= 0 ? usd(delta) + ' MORE' : usd(-delta) + ' LESS'} / mo than today.`)
console.log(`  ${delta >= 0 ? 'The 24/7 GPU is a real fixed cost — the win is scaling, uncapped use, and sovereignty (below).' : 'Sovereign is already cheaper at current scale.'}`)

console.log('\n  SCALING — per-seat (today) vs ~flat (sovereign):')
console.log('    seats   today/mo    sovereign/mo   winner')
for (const s of [6, 10, 15, 20, 30]) {
  const t = todayAt(s), p = projectedAt(s)
  console.log(`    ${String(s).padEnd(7)} ${usd(t).padEnd(11)} ${usd(p).padEnd(14)} ${p < t ? 'SOVEREIGN ✓' : 'google/frontier'}`)
}
// crossover seat count
let cross = null
for (let s = C.workspaceSeats; s <= 100; s++) if (projectedAt(s) < todayAt(s)) { cross = s; break }
console.log(`\n  → Sovereign becomes cheaper at ~${cross ?? '100+'} seats, then stays flat while Google/frontier keep climbing.`)

if (C.agentTokensPerMonthM > 0) {
  const frontierTokenCost = C.agentTokensPerMonthM * C.claudeOutputUsdPerMtok
  console.log(`\n  TOKEN economics (24/7 agents): ${C.agentTokensPerMonthM}M tok/mo`)
  console.log(`    on frontier (metered): ~${usd(frontierTokenCost)} / mo   vs   choir (flat): ${usd(choir)} / mo`)
  console.log(`    ${frontierTokenCost > choir ? `choir is ${usd(frontierTokenCost - choir)} cheaper AND uncapped` : 'frontier cheaper at this volume — agents are light'}`)
} else {
  const breakeven = Math.round(choir / C.claudeOutputUsdPerMtok)
  console.log(`\n  TOKEN break-even: the choir's flat ${usd(choir)}/mo beats metered frontier above ~${breakeven}M tokens/mo`)
  console.log(`    (a single 24/7 agent ≈ ~30M tok/mo → already past break-even; AU rates push it lower).`)
}

console.log('\n  Caveats: ops labor (self-hosting mail/agents is real work), no managed SLA, alpha maturity.')
console.log('  Strengths: flat-with-scale, unlimited/uncapped (vs AU Claude caps), full data sovereignty.')
console.log(line + '\n')
