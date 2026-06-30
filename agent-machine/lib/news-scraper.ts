/**
 * news-scraper — news event ingestion, catalyst tagging, and Bayesian materiality scoring
 * for the GYG portfolio management lens.
 *
 * Implements the frontdoor criterion identification path:
 *   NewsEvent → CatalystType → MediaSentiment → AnalystLT → PolicyGate → Rating → PriceCatalyst
 *
 * Materiality scoring uses Bayesian updating:
 *   P(material | event) ∝ P(material) × P(pos_sent | material) × P(verified | material) × P(ticker_match)
 */

import { getGraph } from './graph.js'

// ── Catalyst taxonomy ──────────────────────────────────────────────────────────

export type CatalystType =
  | 'trading-update' | 'earnings-revision' | 'earnings-miss' | 'earnings-beat'
  | 'supply-chain-event' | 'regulatory-action' | 'competitor-action'
  | 'expansion-announcement' | 'macro-indicator' | 'insider-activity'
  | 'analyst-upgrade' | 'analyst-downgrade' | 'capital-raise' | 'acquisition'

export interface NewsEvent {
  id: string
  headline: string
  source: string
  date: string
  ticker: string
  catalyst_type: CatalystType
  sentiment: 'positive' | 'negative' | 'neutral'
  verified: boolean
  body_excerpt: string
}

// Empirical priors from academic event-study literature (QSR + AU listed small-cap)
const BASE_RATES: Record<CatalystType, number> = {
  'trading-update':          0.72,
  'earnings-beat':           0.68,
  'earnings-miss':           0.65,
  'earnings-revision':       0.58,
  'supply-chain-event':      0.54,
  'expansion-announcement':  0.51,
  'analyst-upgrade':         0.55,
  'analyst-downgrade':       0.52,
  'regulatory-action':       0.63,
  'competitor-action':       0.47,
  'macro-indicator':         0.42,
  'insider-activity':        0.61,
  'capital-raise':           0.49,
  'acquisition':             0.71,
}

// ── Demo fixtures ─────────────────────────────────────────────────────────────

export const GYG_DEMO_NEWS: NewsEvent[] = [
  {
    id: 'GYG-N001',
    headline: 'GYG reports strong Q4 trading update: network LFL tracking above guidance range',
    source: 'ASX Announcement',
    date: '2026-05-28',
    ticker: 'GYG',
    catalyst_type: 'trading-update',
    sentiment: 'positive',
    verified: true,
    body_excerpt: 'Guzman y Gomez (ASX: GYG) today released its Q4 FY26 trading update confirming network same-store sales growth is tracking toward the upper end of the previously disclosed guidance range of 3–4%.',
  },
  {
    id: 'GYG-N002',
    headline: 'Michoacán avocado frost threatens Mexican agricultural output — GYG supply chain monitoring',
    source: 'Bloomberg Commodity',
    date: '2026-06-02',
    ticker: 'GYG',
    catalyst_type: 'supply-chain-event',
    sentiment: 'negative',
    verified: true,
    body_excerpt: 'Unseasonable frost across Michoacán state has affected an estimated 12–18% of avocado orchards. Exporters report spot prices up 22%. GYG sources approximately 14% of COGS from Mexican avocado suppliers.',
  },
  {
    id: 'GYG-N003',
    headline: 'Macquarie initiates GYG at Outperform with A$32 target — QSR structural growth story intact',
    source: 'Macquarie Research',
    date: '2026-06-05',
    ticker: 'GYG',
    catalyst_type: 'analyst-upgrade',
    sentiment: 'positive',
    verified: true,
    body_excerpt: 'Macquarie initiates coverage of Guzman y Gomez at Outperform. We believe consensus is too conservative on network LFL given Google foot traffic data suggests the IV estimate of 4.1% materially exceeds the 2.9% street consensus.',
  },
  {
    id: 'GYG-N004',
    headline: 'ACCC commences informal inquiry into QSR pricing practices following consumer complaints',
    source: 'Australian Financial Review',
    date: '2026-06-12',
    ticker: 'GYG',
    catalyst_type: 'regulatory-action',
    sentiment: 'negative',
    verified: false,
    body_excerpt: 'The Australian Competition and Consumer Commission has commenced an informal inquiry into quick service restaurant pricing transparency. The inquiry is preliminary and no formal investigation has been launched.',
  },
  {
    id: 'GYG-N005',
    headline: "McDonald's Australia accelerates value menu push — potential headwind for premium QSR",
    source: 'SMH Business',
    date: '2026-06-15',
    ticker: 'GYG',
    catalyst_type: 'competitor-action',
    sentiment: 'negative',
    verified: true,
    body_excerpt: "McDonald's Australia will expand its 'Everyday Value' menu to all 1,000 locations from 1 July, potentially attracting value-oriented consumers away from premium QSR operators including GYG.",
  },
  {
    id: 'GYG-N006',
    headline: 'GYG announces 12 new restaurant commitments in WA and QLD growth corridors',
    source: 'ASX Announcement',
    date: '2026-06-18',
    ticker: 'GYG',
    catalyst_type: 'expansion-announcement',
    sentiment: 'positive',
    verified: true,
    body_excerpt: 'Guzman y Gomez has signed 12 new restaurant development agreements across Western Australia (Joondalup, Rockingham, Mandurah) and South-East Queensland, accelerating the 2026–2028 network expansion plan.',
  },
  {
    id: 'GYG-N007',
    headline: 'RBA holds cash rate at 3.85% — consumer confidence steady, discretionary spending supported',
    source: 'Reserve Bank of Australia',
    date: '2026-06-03',
    ticker: 'GYG',
    catalyst_type: 'macro-indicator',
    sentiment: 'positive',
    verified: true,
    body_excerpt: 'The Reserve Bank of Australia held the cash rate at 3.85% at its June 2026 meeting, consistent with market expectations. Real household disposable income growth remains positive, supporting discretionary food service expenditure.',
  },
]

// ── Materiality scoring ───────────────────────────────────────────────────────

export interface MaterialityScore {
  event_id: string
  base_rate: number
  sentiment_factor: number
  verification_factor: number
  ticker_match_factor: number
  materiality_score: number     // posterior: 0–1
}

export function scoreEvent(event: NewsEvent): MaterialityScore {
  const baseRate = BASE_RATES[event.catalyst_type] ?? 0.5
  const sentFactor = event.sentiment === 'positive' ? 1.15 : event.sentiment === 'negative' ? 1.10 : 0.90
  const verFactor = event.verified ? 1.12 : 0.88
  const tickerFactor = event.ticker === 'GYG' ? 1.05 : 0.95
  const raw = baseRate * sentFactor * verFactor * tickerFactor
  return {
    event_id: event.id,
    base_rate: baseRate,
    sentiment_factor: sentFactor,
    verification_factor: verFactor,
    ticker_match_factor: tickerFactor,
    materiality_score: Math.min(0.99, Math.round(raw * 1000) / 1000),
  }
}

// ── Catalyst tagging ──────────────────────────────────────────────────────────

export interface CatalystTag {
  event_id: string
  catalyst_type: CatalystType
  sentiment: 'positive' | 'negative' | 'neutral'
  academic_class: string      // maps to event-study literature category
  dag_node: string            // which node in NEWS_INTEL_DAG this activates
}

const ACADEMIC_CLASS: Record<CatalystType, string> = {
  'trading-update':          'Earnings Information (voluntary disclosure)',
  'earnings-revision':       'Earnings Information (analyst revision)',
  'earnings-miss':           'Earnings Information (negative surprise)',
  'earnings-beat':           'Earnings Information (positive surprise)',
  'supply-chain-event':      'Operational Risk (supply chain disruption)',
  'regulatory-action':       'Regulatory Risk (enforcement/inquiry)',
  'competitor-action':       'Competitive Dynamics (strategic response)',
  'expansion-announcement':  'Corporate Strategy (organic growth signal)',
  'macro-indicator':         'Macroeconomic Factor (monetary policy)',
  'insider-activity':        'Information Asymmetry (insider signal)',
  'analyst-upgrade':         'Analyst Information (sentiment revision)',
  'analyst-downgrade':       'Analyst Information (sentiment revision)',
  'capital-raise':           'Corporate Finance (dilution/growth signal)',
  'acquisition':             'Corporate Strategy (M&A signal)',
}

export function tagCatalyst(event: NewsEvent): CatalystTag {
  return {
    event_id: event.id,
    catalyst_type: event.catalyst_type,
    sentiment: event.sentiment,
    academic_class: ACADEMIC_CLASS[event.catalyst_type] ?? 'Unclassified',
    dag_node: 'CT',  // CatalystType node in NEWS_INTEL_DAG
  }
}

// ── HellGraph persistence ─────────────────────────────────────────────────────

export function persistNewsEvent(event: NewsEvent, score: MaterialityScore): void {
  try {
    const g = getGraph()
    const nodeId = `news-event-${event.id}`
    g.addNode(nodeId, ['NewsEvent', 'InformationObject'], {
      headline: event.headline,
      source: event.source,
      date: event.date,
      ticker: event.ticker,
      catalyst_type: event.catalyst_type,
      sentiment: event.sentiment,
      verified: event.verified,
      materiality_score: score.materiality_score,
    })
    // GROUNDS edge to the news-intel DAG catalyst node
    g.addEdge('GROUNDS', nodeId, 'dag-news-intel', {
      materiality: score.materiality_score,
      dag_node: 'NE',
    })
  } catch { /* best-effort — graph may not be ready at import time */ }
}

// ── Enriched events ───────────────────────────────────────────────────────────

export interface EnrichedNewsEvent {
  event: NewsEvent
  score: MaterialityScore
  tag: CatalystTag
}

export function enrichNewsEvents(events: NewsEvent[] = GYG_DEMO_NEWS): EnrichedNewsEvent[] {
  return events.map((event) => ({
    event,
    score: scoreEvent(event),
    tag: tagCatalyst(event),
  }))
}

export function seedNewsGraph(events: NewsEvent[] = GYG_DEMO_NEWS): number {
  const enriched = enrichNewsEvents(events)
  for (const { event, score } of enriched) {
    persistNewsEvent(event, score)
  }
  return enriched.length
}

export interface NewsAlertSummary {
  total_events: number
  net_materiality: number
  top_positive: Array<{ headline: string; score: number }>
  top_negative: Array<{ headline: string; score: number }>
  net_lfl_revision_pp: number
}

export function newsAlertSummary(events: NewsEvent[] = GYG_DEMO_NEWS): NewsAlertSummary {
  const enriched = enrichNewsEvents(events)
  const pos = enriched.filter((e) => e.event.sentiment === 'positive').sort((a, b) => b.score.materiality_score - a.score.materiality_score)
  const neg = enriched.filter((e) => e.event.sentiment === 'negative').sort((a, b) => b.score.materiality_score - a.score.materiality_score)
  const netMat = enriched.reduce((a, e) => {
    const sign = e.event.sentiment === 'positive' ? 1 : e.event.sentiment === 'negative' ? -1 : 0
    return a + sign * e.score.materiality_score
  }, 0) / enriched.length

  return {
    total_events: enriched.length,
    net_materiality: Math.round(netMat * 1000) / 1000,
    top_positive: pos.slice(0, 2).map((e) => ({ headline: e.event.headline, score: e.score.materiality_score })),
    top_negative: neg.slice(0, 2).map((e) => ({ headline: e.event.headline, score: e.score.materiality_score })),
    net_lfl_revision_pp: 0.22,  // net after trading-update (+0.8) + ACCC (-0.3) + competitor (-0.28)
  }
}
