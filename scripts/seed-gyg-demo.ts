/**
 * seed-gyg-demo — pre-populate the IFM Investors demo with a realistic GYG intelligence task.
 *
 * Run at demo-machine startup (or manually) so Michael walks into Step 3 with a live,
 * pre-populated GYG LFL task: evidence chain populated, causal annotations set,
 * governance trail sealed.
 *
 * Usage:
 *   npx tsx scripts/seed-gyg-demo.ts
 *   (or: NODE_PATH=./agent-machine node --loader ts-node/esm scripts/seed-gyg-demo.ts)
 *
 * The task is seeded via the REST API so the sidecar stores everything in HellGraph
 * exactly as a real run would — the demo is not special-cased anywhere in the product.
 */

const BASE = process.env['NOETICA_API'] ?? 'http://localhost:8080'

interface Step {
  source_url: string
  observation: string
  confidence: number
  agent_reasoning: string
  causal_node: string
  causal_node_label: string
  causal_dag: string
  causal_path: string[]
}

const EVIDENCE: Step[] = [
  {
    source_url: 'https://maps.googleapis.com/maps/api/place/details/json?place_id=ChIJ_GYG_PITT_AU',
    observation: 'Google Popular Times busyness index for 31 GYG locations (AU metro, Jun 2026 trailing 4w): weekday lunch peak = 78/100, Fri dinner peak = 91/100. Annualised trend: +6.2% YoY. Instrument (IV) validity: no plausible direct path from GPT to LFL Revenue — GPT is a search-side proxy, not a price or product signal.',
    confidence: 0.91,
    agent_reasoning: 'GPT data pulled from Maps API, aggregated across 31 locations. IV pre-test: partial F-statistic = 32.4 (> 10 threshold), confirming instrument relevance. Exclusion restriction: academic literature (Glaeser et al 2018) + internal check — no GPT→Revenue direct edge in DAG. IV identification strategy satisfied.',
    causal_node: 'GPT',
    causal_node_label: 'Google Popular Times',
    causal_dag: 'gyg-lfl',
    causal_path: ['GPT', 'FT', 'SLF', 'NLS', 'RE'],
  },
  {
    source_url: 'https://data.bom.gov.au/climate/dwo/202406/html/IDCJDW2124.202406.shtml',
    observation: 'BOM June 2026 (4-week trailing): Sydney mean daily max 17.2°C (−0.8°C vs 5yr avg), rainfall 98mm (+21%). Weather index composite (normalised): 0.61 — moderately unfavourable for outdoor queuing, net negative on foot traffic vs prior period.',
    confidence: 0.88,
    agent_reasoning: 'Weather affects both GPT busyness scores and actual foot traffic — correctly included in the adjustment set. Winter conditions reduce FT by an estimated −4.1% vs summer baseline (GYG historical seasonality from ASX quarterly releases). Covariate W correctly included in the structural model.',
    causal_node: 'W',
    causal_node_label: 'Weather Index',
    causal_dag: 'gyg-lfl',
    causal_path: ['W', 'FT', 'SLF', 'NLS', 'RE'],
  },
  {
    source_url: 'https://www.rba.gov.au/statistics/cash-rate/',
    observation: 'Westpac-MI Consumer Confidence Index June 2026: 82.4 (down 3.1 pts MoM). RBA held cash rate at 4.10%. Discretionary dining sentiment sub-index: 71.2 — below long-run avg of 86.4. Macro headwind to foot traffic is material; estimated FT drag: −2.8%.',
    confidence: 0.79,
    agent_reasoning: 'Consumer confidence is a partially observable covariate (M in DAG). Published monthly with lag — used as adjustment variable in the IV regression, not an instrument. RBA hold (consensus) removes monetary policy surprise from the signal. Including M correctly isolates the GPT→FT→LFL causal path from macro regime confounding.',
    causal_node: 'M',
    causal_node_label: 'Macro Sentiment',
    causal_dag: 'gyg-lfl',
    causal_path: ['M', 'FT', 'SLF', 'NLS', 'RE'],
  },
  {
    source_url: 'https://maps.googleapis.com/maps/api/place/details/json?place_id=ChIJ_GYG_FT_AGGREGATE',
    observation: 'Foot Traffic Index (FT) — aggregated across 31 GYG stores using GPT as instrument: FT_index = 64.7 (IV-instrumented). This is the IV first stage: FT̂ estimated from GPT, W, H; R² = 0.74. Covariate-adjusted for weather and macro sentiment.',
    confidence: 0.87,
    agent_reasoning: 'IV first stage complete. FT instrumented via GPT with adjustment set {W, H, M}. Partial R² for instrument alone = 0.41. Predicted FT_index = 64.7 — consistent with weather drag and post-COVID normalization trend. Competitor Activity (C) remains unobserved — this is precisely why IV is the identification strategy over OLS.',
    causal_node: 'FT',
    causal_node_label: 'Foot Traffic Index',
    causal_dag: 'gyg-lfl',
    causal_path: ['FT', 'SLF', 'NLS', 'RE'],
  },
  {
    source_url: 'https://www.guzmanygomez.com/investors/asx-announcements/',
    observation: 'GYG menu price audit (app scrape + ASX FY26 guidance): average ticket price +3.8% YoY across all categories. Burrito Meal = $17.90 (+$0.70). No promotional discounting in the trailing 4 weeks. Menu Price Changes (MP) covariate: net positive on SLF Revenue (+3.8% price effect, volume-adjusted).',
    confidence: 0.93,
    agent_reasoning: 'MP is a directly observed covariate in the structural model — it has an independent effect on SLF Revenue that must be controlled for. Source: GYG ASX FY26 cost guidance (released 14 Jun 2026) + real-time app price scrape. No competitor pricing surprise. MP correctly included in the adjustment set for the IV second stage.',
    causal_node: 'MP',
    causal_node_label: 'Menu Price Changes',
    causal_dag: 'gyg-lfl',
    causal_path: ['MP', 'SLF', 'NLS', 'RE'],
  },
  {
    source_url: 'urn:noetica:compute:iv-second-stage:gyg-lfl-jun2026',
    observation: 'IV second stage: Store-Level LFL Revenue estimate. Using FT̂ (instrumented), MP, W, H as regressors on historical ASX quarterly LFL disclosures (8 quarters). Coefficient on FT̂: +0.47 (s.e. 0.09, p<0.001). Predicted SLF index: 68.3. Projected FY26 store-level LFL: +4.1% (range +2.8% to +5.4%, 90% CI).',
    confidence: 0.84,
    agent_reasoning: 'IV second stage converged on a positive and statistically significant FT̂ → SLF coefficient. Confidence is high but not maximum — competitor activity C is unobserved and its hidden influence on SLF creates irreducible uncertainty. The IV identification strategy accounts for this: the GPT instrument is orthogonal to C by design. 90% CI is honest about residual uncertainty.',
    causal_node: 'SLF',
    causal_node_label: 'Store LFL Revenue',
    causal_dag: 'gyg-lfl',
    causal_path: ['SLF', 'NLS', 'RE'],
  },
  {
    source_url: 'urn:noetica:compute:network-aggregation:gyg-lfl-jun2026',
    observation: 'Network LFL Signal (NLS): cross-store aggregate of 31 store-level SLF estimates, trimmed mean (10% winsorization). NLS = +4.1% YoY. Signal-to-noise ratio vs unadjusted GPT correlation: +38% improvement from IV instrumentation. Outlier stores removed: 2 (renovations confirmed via Google Maps closures).',
    confidence: 0.86,
    agent_reasoning: 'Network aggregation reduces idiosyncratic store-level noise. Two stores excluded (confirmed temporary closures via Google Maps "temporarily closed" flag — this is itself a GPT data point, validating the instrument). NLS is the intelligence signal: +4.1% is above consensus (+2.9%) by 120bp. This is the alpha-generative claim to test against the Q4 FY26 result.',
    causal_node: 'NLS',
    causal_node_label: 'Network LFL Signal',
    causal_dag: 'gyg-lfl',
    causal_path: ['NLS', 'RE'],
  },
]

// Supply chain evidence steps (second causal path: SC → IC/GA → LFL)
const SUPPLY_CHAIN_EVIDENCE: Step[] = [
  {
    source_url: 'https://www.avocadosfrommexico.com/industry/news/',
    observation: 'Michoacán frost event (3 Jun 2026): Mexican Avocado Producers Association confirms 15–20% of flowering crop affected. Export volume −18% for 4–6 weeks. Hass avocado spot price in Sydney wholesale: +38% week-on-week to AUD $3.20/unit (from $2.32 base). GYG avocado spend share ~14% of COGS — total input cost basket impact: +3.8% above base.',
    confidence: 0.89,
    agent_reasoning: 'Supply chain event SC-001 confirmed as severe. Avocado is the highest-volatility, non-substituable ingredient in the GYG basket. Frost events in Michoacán are well-documented IV candidates for cost-shock identification — they are exogenous to Australian consumer demand and orthogonal to GYG\'s foot traffic signal. Input cost index rises to 103.8 (base 100). This is the dominant supply chain shock in the current period.',
    causal_node: 'SC',
    causal_node_label: 'Supply Chain Event',
    causal_dag: 'gyg-supply',
    causal_path: ['SC', 'IC', 'MPP', 'LFL'],
  },
  {
    source_url: 'https://www.mla.com.au/prices-markets/price-reporting/young-cattle/',
    observation: 'East Coast Cattle Indicator (ECCI): 382¢/kg LW on 10 Jun 2026 (+14% vs 30-day avg of 335¢/kg). GYG beef mince COGS hedge: forward contract through Jul 2026 at 340¢/kg — immediate margin impact is deferred. However, Q4 FY26 contract renewal at spot would add ~2.1% to total input cost basket. Monitoring as "moderate" event.',
    confidence: 0.82,
    agent_reasoning: 'Cattle price spike SC-002 is a moderate event with deferred impact. The forward contract provides near-term protection, confirming GYG management are active hedgers. This is important: the immediate supply chain LFL revision from beef is 0bp (hedged), but the forward-looking Q4 signal is negative. For our Jun 2026 estimate, beef contributes 0pp to cost uplift. The cattle price level is tracked as a leading indicator.',
    causal_node: 'IC',
    causal_node_label: 'Input Cost Index',
    causal_dag: 'gyg-supply',
    causal_path: ['IC', 'MPP', 'LFL'],
  },
  {
    source_url: 'https://www.portofmelbourne.com/operational-updates/',
    observation: 'Port of Melbourne stevedore industrial action (22–27 Jun 2026): tortilla and packaging containers delayed 7–10 days. ABF biosecurity hold on 1 jalapeño container (routine inspection). Estimated impact: VIC stores (7 locations, 22% of network revenue) may run limited menu for 1–2 days. Gross Availability estimated at 89.0% full menu vs 100% base.',
    confidence: 0.77,
    agent_reasoning: 'Port congestion SC-003 creates a localised gross availability shock. GA drops to 89% of stores on full menu — avocado and jalapeño items most affected (guac, nachos). Limited menu stores historically see −4.5% same-day transactions vs full-menu days (GYG ASX investor day disclosure). Availability drag on effective foot traffic: −2.7% for VIC stores, −0.8% network-wide. This is the GA → EFT → LFL path in the supply chain DAG.',
    causal_node: 'GA',
    causal_node_label: 'Gross Availability',
    causal_dag: 'gyg-supply',
    causal_path: ['GA', 'EFT', 'LFL'],
  },
  {
    source_url: 'urn:noetica:compute:menu-price-pressure:gyg-supply-jun2026',
    observation: 'Pass-through decision model: based on 4 prior GYG ASX price announcements, historical pass-through rate is ~40% of input cost increases above 2% threshold. Current input cost uplift = 3.8% (avocado-driven). Expected menu price adjustment: +1.5% (0.40 × 3.8%). Avocado-heavy items (Burrito Bowl, Nachos) most likely to see price uplift. Timing: likely Q4 FY26 menu refresh.',
    confidence: 0.71,
    agent_reasoning: 'MPP confidence is lower — the pass-through decision is a management choice, not mechanistically determined. GYG has previously held prices for 4–6 weeks post-shock to protect volume, then passed through on menu refresh cycles. Best estimate: +1.5% MPP contribution to LFL (+positive revenue effect) offset by −0.9% volume effect from price elasticity. Net MPP contribution to LFL: +0.6pp. This is the IC → MPP → LFL path. Flagged for low confidence per policy gate.',
    causal_node: 'MPP',
    causal_node_label: 'Menu Price Pressure',
    causal_dag: 'gyg-supply',
    causal_path: ['MPP', 'LFL'],
  },
]

const CAUSAL_CERTIFICATE = {
  causal_model: 'gyg-lfl',
  identification_strategy: 'iv',
  causal_summary:
    'IV identification via Google Popular Times (GPT) as instrument for Foot Traffic Index (FT). ' +
    'Relevance confirmed: partial F-statistic = 32.4. Exclusion restriction satisfied: no directed path ' +
    'GPT → LFL Revenue except through FT (verified in DAG; consistent with academic literature). ' +
    'Hidden confounder (Competitor Activity) correctly handled by IV — OLS would be biased. ' +
    'Second-stage estimate: FT̂ coefficient = +0.47 (p<0.001). Network LFL Signal = +4.1% YoY, ' +
    'above analyst consensus (+2.9%) by 120bp. ' +
    'Supply chain signal (gyg-supply DAG, natural-experiment identification): Michoacán frost adds ' +
    '+3.8% to input cost basket; gross availability at 89%; net supply chain LFL revision = −0.4pp. ' +
    'Combined signal: +3.7% YoY (still above consensus). ASIC-defensible: full causal DAG + IV certificate ' +
    'in governance trail, reproducible via urn:noetica:replay:{task_id}.',
}

const OUTPUT =
  'GYG (ASX: GYG) Like-for-Like Signal — IFM Investors Intelligence Task\n\n' +
  '━━ COMBINED SIGNAL ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n' +
  'LFL ESTIMATE: +3.7% YoY (90% CI: +2.4% to +5.0%) — ABOVE CONSENSUS (+2.9%)\n\n' +
  '━━ FOOT TRAFFIC SIGNAL (gyg-lfl IV) ─────────────────────────────────────\n' +
  'CAUSAL IDENTIFICATION: Instrumental Variable (IV) via Google Popular Times.\n' +
  'Relevance: F-statistic = 32.4. Exclusion: no direct GPT → LFL path in DAG.\n' +
  'Raw signal: +4.1% YoY. 31 locations, 29 at full signal quality.\n\n' +
  '━━ SUPPLY CHAIN SIGNAL (gyg-supply natural experiment) ──────────────────\n' +
  'Michoacán frost (SC-001, severe): avocado cost +38% spot; input basket +3.8%.\n' +
  'East Coast cattle (SC-002, moderate): hedged to Jul, Q4 FY26 watch.\n' +
  'Port Melbourne (SC-003, moderate): 7 VIC locations on limited menu; GA = 89%.\n' +
  'Net supply chain LFL revision: −0.4pp (cost pass-through +0.6pp, availability −1.0pp).\n\n' +
  '━━ LOCATION-LEVEL BREAKDOWN ─────────────────────────────────────────────\n' +
  'Drive-through: highest busyness index (weather-insensitive). Airport: +2.1% above base.\n' +
  'CBD: −3.8% (winter, macro drag). Food-court: most exposed to avocado availability.\n' +
  'University (Kingsford): semester trade strong despite weather.\n\n' +
  '━━ GOVERNANCE ────────────────────────────────────────────────────────────\n' +
  'Dual causal DAG: gyg-lfl (IV identification) + gyg-supply (natural experiment).\n' +
  'Policy gate: confidence threshold 0.70, source monitoring, flag-on-change.\n' +
  'Full evidence chain with causal annotations. ASIC-defensible + replayable.'

async function post(path: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`POST ${path} → ${res.status}: ${text}`)
  }
  return res.json()
}

async function get(path: string): Promise<unknown> {
  const res = await fetch(`${BASE}${path}`)
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`)
  return res.json()
}

async function main() {
  console.log(`[seed-gyg-demo] seeding against ${BASE}`)

  // 1. Create task
  const task = await post('/api/intelligence/tasks', {
    name: 'GYG Like-for-Like Signal — IFM Investors Demo',
    objective:
      'Produce a causal, ASIC-defensible like-for-like sales estimate for GYG (ASX: GYG) ' +
      'using Google Popular Times as an instrumental variable for foot traffic. ' +
      'For: Ya Ying (Portfolio Manager, IFM Investors).',
    owner: 'michael@socioprophet.ai',
    policy: {
      confidence_threshold: 0.70,
      allowed_sources: [],
      flag_on_source_change: false,
      flag_on_low_confidence: true,
    },
  }) as { id: string; name: string }
  console.log(`  → task ${task.id}: "${task.name}"`)

  // 2. Start task
  await post(`/api/intelligence/tasks/${task.id}/start`, {})
  console.log(`  → started`)

  // 3a. Add foot traffic IV evidence steps
  const allEvidence = [...EVIDENCE, ...SUPPLY_CHAIN_EVIDENCE]
  for (let i = 0; i < allEvidence.length; i++) {
    const step = await post(`/api/intelligence/tasks/${task.id}/evidence`, allEvidence[i]) as { id: string; flagged: boolean }
    const e = allEvidence[i]!
    console.log(`  → evidence [${i + 1}/${allEvidence.length}] ${e.causal_dag}:${e.causal_node} (${e.confidence}) ${step.flagged ? '⚠ flagged' : '✓'}`)
  }

  // 4. Complete and seal governance trail with causal certificate
  const completed = await post(`/api/intelligence/tasks/${task.id}/complete`, {
    output: OUTPUT,
    ...CAUSAL_CERTIFICATE,
  }) as { id: string; governance: { output_hash: string; causal_model: string; identification_strategy: string } }
  console.log(`  → completed: output_hash=${completed.governance.output_hash}`)
  console.log(`  → causal: model=${completed.governance.causal_model} strategy=${completed.governance.identification_strategy}`)

  // 5. Trigger causal annotation writeback for both DAGs
  await post('/api/causal/annotate', { task_id: completed.id, dag: 'gyg-lfl' })
  await post('/api/causal/annotate', { task_id: completed.id, dag: 'gyg-supply' })
  console.log(`  → causal evidence annotated in HellGraph (gyg-lfl + gyg-supply)`)

  // 5b. Log supply chain signal snapshot
  const scSignal = await get('/api/supply-chain/signal') as { lfl_revision_pct: number; margin_drag_pct: number; summary: string }
  console.log(`  → supply chain: LFL revision ${scSignal.lfl_revision_pct}pp, margin drag ${scSignal.margin_drag_pct}bp`)

  // 5c. Log location traffic aggregate
  const traffic = await get('/api/location-traffic/aggregate') as { total_iv_transactions: number; lfl_index: number; total_weekly_revenue_aud: number }
  console.log(`  → location traffic: ${traffic.total_iv_transactions} transactions/wk, LFL index ${traffic.lfl_index}, $${(traffic.total_weekly_revenue_aud / 1e6).toFixed(2)}M revenue`)

  // 6. Verify — fetch and display governance trail
  const verify = await get(`/api/intelligence/tasks/${completed.id}`) as {
    name: string; status: string;
    evidence: { causal_node?: string; confidence: number; flagged: boolean }[]
    governance: { evidence_count: number; flagged_count: number; causal_model?: string; identification_strategy?: string; output_hash?: string }
  }
  console.log('\n[seed-gyg-demo] governance trail:')
  console.log(`  name:     ${verify.name}`)
  console.log(`  status:   ${verify.status}`)
  console.log(`  evidence: ${verify.governance.evidence_count} steps (${verify.governance.flagged_count} flagged)`)
  console.log(`  causal:   ${verify.governance.causal_model} / ${verify.governance.identification_strategy}`)
  console.log(`  hash:     ${verify.governance.output_hash}`)
  console.log(`\n[seed-gyg-demo] done — task id: ${completed.id}`)
  console.log(`  demo URL: GET ${BASE}/api/intelligence/tasks/${completed.id}`)
}

main().catch((e) => { console.error('[seed-gyg-demo] ERROR:', e); process.exit(1) })
