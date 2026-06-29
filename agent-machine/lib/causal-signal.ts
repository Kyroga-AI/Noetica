/**
 * causal-signal — pre-defined causal DAG models for financial intelligence signals.
 *
 * Ships two hard-coded models for the IFM Investors demo:
 *
 *   GYG_LFL_DAG   — Guzman & Gomez (ASX: GYG) like-for-like sales prediction.
 *                   Google Popular Times as an instrumental variable for store foot
 *                   traffic. Key claim: GPT → FT → StoreLFL_Revenue with GPT having
 *                   no direct path to LFL Revenue (exclusion restriction satisfied).
 *                   Identification strategy: INSTRUMENTAL VARIABLE.
 *
 *   NEWS_INTEL_DAG — Ya Ying's news-intelligence agent causal chain.
 *                   NewsEvent → CatalystTag → MaterialityScore → Alert → PolicyGate
 *                   → ResearchNote → PositionChange.
 *                   The PolicyGate (SP addition) sits on the frontdoor path, blocking
 *                   the hidden MarketRegime confounder from contaminating the chain.
 *                   Identification strategy: FRONTDOOR CRITERION via PolicyGate.
 *
 * Both models export the DAG, the identification result, and a human-readable
 * causal argument string suitable for the governance trail and ASIC presentation.
 */
import type { CausalDAG } from './causal-graph.js'
import { identifyCausalEffect, primaryCausalPath } from './causal-graph.js'

// ── GYG Like-for-Like Signal ──────────────────────────────────────────────────

export const GYG_LFL_DAG: CausalDAG = {
  name: 'gyg-lfl',
  description: 'GYG (ASX: GYG) like-for-like sales prediction via Google Popular Times instrumental variable',
  treatment: 'FT',
  outcome: 'RE',
  nodes: [
    { id: 'W',   label: 'Weather Index',       type: 'exogenous',   description: 'Daily weather index (temperature, rainfall). Affects both Google Popular Times data and actual store visit frequency. Observable — include in adjustment set.' },
    { id: 'H',   label: 'Holiday Calendar',    type: 'exogenous',   description: 'Public holiday and school holiday calendar. Significant driver of foot traffic patterns and consumer discretionary spending. Observable — include in adjustment set.' },
    { id: 'M',   label: 'Macro Sentiment',     type: 'exogenous',   description: 'Consumer confidence index (Westpac-MI monthly). Affects discretionary dining frequency. Partially observable — published monthly with lag.' },
    { id: 'GPT', label: 'Google Popular Times', type: 'instrument',  description: 'INSTRUMENT (IV). Google Maps "popular times" busyness scores for individual GYG locations. Satisfies: (1) relevance — GPT strongly predicts FT; (2) exclusion — GPT has no direct effect on LFL Revenue except through Foot Traffic.' },
    { id: 'C',   label: 'Competitor Activity', type: 'hidden',      description: 'HIDDEN CONFOUNDER. Competitor promotions (Grill\'d, Zambreros) affect both foot traffic near GYG stores AND store-level LFL Revenue directly. Unobservable at the frequency we need. Makes backdoor criterion fail — motivates the IV strategy.' },
    { id: 'FT',  label: 'Foot Traffic Index',  type: 'endogenous',  description: 'Aggregate foot traffic index across 30+ GYG locations, instrumented by GPT. The treatment variable whose effect on LFL Revenue we want to identify causally.' },
    { id: 'MP',  label: 'Menu Price Changes',  type: 'exogenous',   description: 'GYG menu price changes (sourced from earnings guidance and app price monitoring). Direct cause of LFL Revenue independent of traffic volume. Must be in covariate set.' },
    { id: 'SLF', label: 'Store LFL Revenue',   type: 'endogenous',  description: 'Store-level like-for-like revenue. Caused by FT (via the IV-identified path), MP, and hidden Competitor Activity. This is the target outcome for the store-level signal.' },
    { id: 'NLS', label: 'Network LFL Signal',  type: 'endogenous',  description: 'Aggregated network-wide LFL estimate: mean of store-level signals with outlier trimming. Noise reduction by averaging across 30+ locations. The intelligence signal the agent produces.' },
    { id: 'RE',  label: 'Revenue Estimate',    type: 'financial',   description: 'Analyst revenue estimate update triggered by NLS. This is the causal endpoint for the intelligence task. Governed and documented via SP IntelligenceTask.' },
  ],
  edges: [
    { from: 'W',   to: 'GPT', effect: 'positive' },
    { from: 'H',   to: 'GPT', effect: 'positive' },
    { from: 'W',   to: 'FT',  effect: 'positive' },
    { from: 'H',   to: 'FT',  effect: 'positive' },
    { from: 'M',   to: 'FT',  effect: 'positive' },
    { from: 'GPT', to: 'FT',  effect: 'positive' },
    { from: 'C',   to: 'FT',  latent: true,  effect: 'negative' },
    { from: 'C',   to: 'SLF', latent: true,  effect: 'negative' },
    { from: 'FT',  to: 'SLF', effect: 'positive' },
    { from: 'MP',  to: 'SLF', effect: 'positive' },
    { from: 'SLF', to: 'NLS', effect: 'positive' },
    { from: 'NLS', to: 'RE',  effect: 'positive' },
  ],
}

// ── News Intelligence Chain ───────────────────────────────────────────────────

export const NEWS_INTEL_DAG: CausalDAG = {
  name: 'news-intel',
  description: 'News-intelligence agent causal chain: news event → governed alert → position change',
  treatment: 'ALT',
  outcome: 'PC',
  nodes: [
    { id: 'NE',  label: 'News Event',         type: 'exogenous',   description: 'Global and Australian financial news, scraped daily. Raw, unfiltered. Exogenous to the investment process — the world generates news regardless of portfolio.' },
    { id: 'MR',  label: 'Market Regime',      type: 'hidden',      description: 'HIDDEN CONFOUNDER. Risk-on / risk-off market regime affects (a) what news gets attention and publication prominence, and (b) how positions are sized independent of any specific catalyst. Cannot be fully observed at the required frequency.' },
    { id: 'CT',  label: 'Catalyst Tag',       type: 'endogenous',  description: 'AI-generated materiality tag from Ya Ying\'s Qwen agent. Applies meta-tagging logic from academic papers: CEO resignation = flag (high materiality); raw revenue number = ignore (low materiality). This is where the existing agent adds value.' },
    { id: 'BR',  label: 'Base Rate Expect.',  type: 'exogenous',   description: 'Prior probability that this catalyst type actually moves the stock, learned from historical catalyst → return data. Observable — estimated from Ya Ying\'s historical alert database. Bayesian update ingredient for MaterialityScore.' },
    { id: 'MS',  label: 'Materiality Score',  type: 'endogenous',  description: 'P(material | CatalystTag, BaseRate). Posterior materiality estimate. The output of Ya Ying\'s academic meta-tagging model. SP inherits this score and wraps it in a governance layer.' },
    { id: 'ALT', label: 'Alert Fired',        type: 'endogenous',  description: 'Threshold crossing: MaterialityScore > τ (configurable). In Ya Ying\'s current Qwen setup, this fires directly to action. In SP, it passes through the PolicyGate first. The treatment variable for the position change identification problem.' },
    { id: 'PG',  label: 'Policy Gate (SP)',   type: 'gate',        description: 'SocioProphet addition. PolicyGate enforces: confidence ≥ threshold, source not changed, alert authorised by policy reference. FRONTDOOR mediator: all directed paths ALT → PC pass through PG. Blocks the hidden MarketRegime confounder from contaminating the PositionChange.' },
    { id: 'RN',  label: 'Research Note',      type: 'endogenous',  description: 'Structured analyst note generated after the PolicyGate admits the alert. References the IntelligenceTask URN, PolicyGate decision, and evidence chain. The governed, replayable, ASIC-visible research artefact.' },
    { id: 'PC',  label: 'Position Change',    type: 'decision',    description: 'DECISION node. Trading action documented with full provenance chain back to NewsEvent → CatalystTag → MaterialityScore → Alert → PolicyGate → ResearchNote. This is the ASIC-defensible causal trail.' },
  ],
  edges: [
    { from: 'NE',  to: 'CT',  effect: 'positive' },
    { from: 'MR',  to: 'NE',  latent: true },
    { from: 'MR',  to: 'PC',  latent: true,  label: 'hidden regime influence' },
    { from: 'BR',  to: 'MS',  effect: 'positive' },
    { from: 'CT',  to: 'MS',  effect: 'positive' },
    { from: 'MS',  to: 'ALT', effect: 'positive' },
    { from: 'ALT', to: 'PG',  effect: 'positive' },
    { from: 'PG',  to: 'RN',  effect: 'positive' },
    { from: 'RN',  to: 'PC',  effect: 'positive' },
  ],
}

// ── Model registry ────────────────────────────────────────────────────────────

const REGISTRY: Record<string, CausalDAG> = {
  'gyg-lfl':    GYG_LFL_DAG,
  'news-intel': NEWS_INTEL_DAG,
}

export function getCausalModel(name: string): CausalDAG | null {
  return REGISTRY[name] ?? null
}

export function listCausalModels(): Array<{ name: string; description: string; treatment?: string; outcome?: string; nodes: number; edges: number }> {
  return Object.entries(REGISTRY).map(([name, dag]) => ({
    name,
    description: dag.description,
    treatment: dag.treatment,
    outcome: dag.outcome,
    nodes: dag.nodes.length,
    edges: dag.edges.length,
  }))
}

/** Full model response: DAG + identification result + primary causal path. */
export function causalModelResponse(name: string): {
  dag: CausalDAG
  identification: ReturnType<typeof identifyCausalEffect>
  primary_path: string[]
  primary_path_labels: string[]
} | null {
  const dag = getCausalModel(name)
  if (!dag) return null
  const identification = identifyCausalEffect(dag)
  const primary_path = primaryCausalPath(dag)
  const nodeLabel = new Map(dag.nodes.map((n) => [n.id, n.label]))
  const primary_path_labels = primary_path.map((id) => nodeLabel.get(id) ?? id)
  return { dag, identification, primary_path, primary_path_labels }
}

/** For a given observation node id in a named DAG, return:
 *  - the node description
 *  - its position in the primary causal path (null if not on path)
 *  - the path from this node to the outcome
 */
export function nodeContext(
  dagName: string,
  nodeId: string,
): {
  node: (typeof GYG_LFL_DAG.nodes)[number] | null
  primary_path: string[]
  path_to_outcome: string[]
  path_position: number | null
} {
  const dag = getCausalModel(dagName)
  if (!dag) return { node: null, primary_path: [], path_to_outcome: [], path_position: null }
  const node = dag.nodes.find((n) => n.id === nodeId) ?? null
  const primary_path = primaryCausalPath(dag)
  const path_position = primary_path.indexOf(nodeId)
  const path_to_outcome = dag.outcome
    ? primaryCausalPath(dag, nodeId, dag.outcome)
    : []
  return { node, primary_path, path_to_outcome, path_position: path_position >= 0 ? path_position : null }
}
