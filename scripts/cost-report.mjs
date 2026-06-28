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
  claudeAuPerSeat: 29.00,          // AU Team-class ≈ A$38/seat (US$25 + 10% GST + FX ~17% premium). ~$26 if ABN-registered (GST reverse-charged). Looked up 2026.
  chatgptPerSeat: 20.00,           // ChatGPT Plus (1 seat).
  claudeTokenOverageUsdPerMo: 233, // ACTUAL (USD): ~$700 over list across the last 90 days = metered token usage BEYOND the seats. This is the variable cost the flat choir replaces with $0 marginal.
  personalClaudeProUsdPerMo: 22,   // a PERSONAL Pro account used HEAVILY because the metered enterprise seats are too costly. Shadow usage: ungoverned, data off-platform, and proof true demand >> the enterprise bill.

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
  claudeOverage: C.claudeTokenOverageUsdPerMo,   // metered token usage beyond seats (their actual)
  personalPro: C.personalClaudeProUsdPerMo,      // shadow usage on a personal account (ungoverned)
}
today.total = today.workspace + today.claude + today.chatgpt + today.claudeOverage + today.personalPro

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
  return ws + llm + C.claudeTokenOverageUsdPerMo // + metered overage (held flat here; in reality it GROWS with agent use, so this understates today)
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

console.log('\n  ┌─ BUCKET 1 — WORKSPACE (no GPU; light k8s services only) ─────')
console.log(`  │  TODAY     Google Workspace ${C.workspaceSeats} seats   ${usd(today.workspace)} /mo   (actual invoice)`)
console.log(`  │  PROJECTED prophet-workspace on GKE   ${usd(projected.workspace)} /mo   (mail+smtp+caldav+office+glue on 1 node + 500GB; control plane $0)`)
const wsDelta = projected.workspace - today.workspace
console.log(`  │  → ${wsDelta >= 0 ? usd(wsDelta) + ' MORE' : usd(-wsDelta) + ' LESS'} /mo at ${C.workspaceSeats} seats; flat vs Google's per-seat. Easy win at scale.`)
console.log('  └──────────────────────────────────────────────────────────────')

console.log('\n  ┌─ BUCKET 2 — AI (GPU; the cloud choir = mesh-vllm-serve) ─────')
console.log(`  │  TODAY     seats: Claude AU ${C.claudeSeats} + ChatGPT ${C.chatgptSeats}   ${usd(today.claude + today.chatgpt)} /mo`)
console.log(`  │            + metered token OVERAGE   ${usd(today.claudeOverage)} /mo   (ACTUAL: ~$700 over list / 90d — the variable cost)`)
console.log(`  │            + personal Pro (SHADOW use)   ${usd(today.personalPro)} /mo   (ungoverned; heavy use offloaded here ∵ enterprise too costly)`)
console.log(`  │            = ${usd(today.claude + today.chatgpt + today.claudeOverage + today.personalPro)} /mo actual  (+ unmeasured shadow demand)`)
console.log(`  │  PROJECTED choir 24/7 (L4, ${C.choirBilling}) ${usd(projected.choir)} + BYOK fallback ${usd(projected.byok)} = ${usd(projected.choir + projected.byok)} /mo  (overage → $0; flat; shadow use comes in-house, governed)`)
console.log(`  │            + training (LoRA/gpu-train): VARIABLE, on-demand Jobs — bill only while running (~$5–50/run), not monthly.`)
const aiToday = today.claude + today.chatgpt + today.claudeOverage + today.personalPro, aiProj = projected.choir + projected.byok
const aiDelta = aiProj - aiToday
console.log(`  │  → ${aiDelta >= 0 ? usd(aiDelta) + ' MORE' : usd(-aiDelta) + ' LESS'} /mo at this scale (24/7 GPU is real). Wins on tokens, scale, uncapped, sovereignty.`)
console.log(`  │    (choir scales-to-zero when idle — non-24/7 is cheaper; you chose 24/7 for always-on agents.)`)
console.log('  └──────────────────────────────────────────────────────────────')

console.log('\n  COMBINED')
console.log(`    TODAY      ${usd(today.total)} / mo   →   ${usd(today.total * 12)} / yr`)
console.log(`    PROJECTED  ${usd(projected.total)} / mo   →   ${usd(projected.total * 12)} / yr`)

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
