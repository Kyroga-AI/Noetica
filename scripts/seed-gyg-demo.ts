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

const CAUSAL_CERTIFICATE = {
  causal_model: 'gyg-lfl',
  identification_strategy: 'iv',
  causal_summary:
    'IV identification via Google Popular Times (GPT) as instrument for Foot Traffic Index (FT). ' +
    'Relevance confirmed: partial F-statistic = 32.4. Exclusion restriction satisfied: no directed path ' +
    'GPT → LFL Revenue except through FT (verified in DAG; consistent with academic literature). ' +
    'Hidden confounder (Competitor Activity) correctly handled by IV — OLS would be biased. ' +
    'Second-stage estimate: FT̂ coefficient = +0.47 (p<0.001). Network LFL Signal = +4.1% YoY, ' +
    'above analyst consensus (+2.9%) by 120bp. ASIC-defensible: full causal DAG + IV certificate ' +
    'in governance trail, reproducible via urn:noetica:replay:{task_id}.',
}

const OUTPUT =
  'GYG (ASX: GYG) Like-for-Like Signal — IFM Investors Intelligence Task\n\n' +
  'SIGNAL: +4.1% YoY network LFL (90% CI: +2.8% to +5.4%) — ABOVE CONSENSUS (+2.9%)\n\n' +
  'CAUSAL IDENTIFICATION: Instrumental Variable (IV) via Google Popular Times.\n' +
  'The IV strategy is required because Competitor Activity is an unobserved confounder. ' +
  'GPT satisfies both IV conditions: (1) relevance (F=32.4), (2) exclusion restriction (no direct path to revenue).\n\n' +
  'ADJUSTMENT SET: Weather Index, Holiday Calendar, Menu Price Changes, Macro Sentiment (Consumer Confidence).\n\n' +
  'ESTIMATE: Store-level LFL +4.1%, driven by +6.2% YoY Google busyness trend, offset by winter weather (−4.1%) ' +
  'and soft consumer confidence. Menu price lift (+3.8%) provides independent revenue support.\n\n' +
  'GOVERNANCE: Task URN in HellGraph. Full evidence chain with causal annotations. ' +
  'Policy gate: confidence threshold 0.70, source monitoring, flag-on-change. ' +
  'This intelligence output is replayable and ASIC-defensible.'

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

  // 3. Add evidence steps with causal annotations
  for (let i = 0; i < EVIDENCE.length; i++) {
    const step = await post(`/api/intelligence/tasks/${task.id}/evidence`, EVIDENCE[i]) as { id: string; flagged: boolean }
    console.log(`  → evidence [${i + 1}/${EVIDENCE.length}] ${EVIDENCE[i]!.causal_node} (${EVIDENCE[i]!.confidence}) ${step.flagged ? '⚠ flagged' : '✓'}`)
  }

  // 4. Complete and seal governance trail with causal certificate
  const completed = await post(`/api/intelligence/tasks/${task.id}/complete`, {
    output: OUTPUT,
    ...CAUSAL_CERTIFICATE,
  }) as { id: string; governance: { output_hash: string; causal_model: string; identification_strategy: string } }
  console.log(`  → completed: output_hash=${completed.governance.output_hash}`)
  console.log(`  → causal: model=${completed.governance.causal_model} strategy=${completed.governance.identification_strategy}`)

  // 5. Trigger causal annotation writeback into HellGraph
  await post('/api/causal/annotate', { task_id: completed.id, dag: 'gyg-lfl' })
  console.log(`  → causal evidence annotated in HellGraph`)

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
