/**
 * supply-chain — GYG supply chain event model and causal DAG.
 *
 * GYG's brand promise (fresh, authentic Mexican) depends on a small number of
 * key ingredients that are genuinely volatile:
 *
 *   Hass avocado   — 90%+ Mexico / Colombia origin; cyclically price-volatile;
 *                    frost events in Michoacán cause 2–4 week supply gaps
 *   Beef mince     — Australian-sourced; East Coast Cattle Market price
 *   Chicken thigh  — Australian (Inghams, Baiada); less volatile but seasonal
 *   Corn tortilla  — Mexico / Texas import; freight cost exposure
 *   Jalapeño       — Mexico origin; subject to same Michoacán weather risk
 *
 * The supply chain signal is a SECOND causal path on top of the foot-traffic IV:
 *
 *   Supply Event (SC) → Input Cost Index (IC) → Menu Price Pressure (MPP) → LFL↓
 *                     → Gross Availability  (GA) → Effective FT (EFT)     → LFL↓
 *
 * SC is exogenous to demand — it gives a natural-experiment identification of the
 * cost pass-through coefficient and the availability-traffic elasticity separately
 * from the foot-traffic IV path.
 *
 * Identification strategy: SC is an instrument for IC and GA jointly. Because SC
 * (weather event, freight disruption) has no direct path to LFL Revenue except
 * through IC and GA, it satisfies the exclusion restriction. This lets us bound
 * the cost pass-through and availability elasticity from below, even when the
 * demand-side hidden confounder (Market Demand) is unobserved.
 */
import type { CausalDAG } from './causal-graph.js'

// ── Supplier Registry ────────────────────────────────────────────────────────

export interface GYGSupplier {
  id: string
  name: string
  ingredient: string
  origin: string                    // primary sourcing geography
  spend_share: number               // estimated % of COGS (0–1)
  volatility: 'low' | 'medium' | 'high' | 'very_high'
  lead_time_days: number            // typical replenishment lead time
  substituability: 'none' | 'partial' | 'full'
  exposure_events: string[]         // types of supply events that affect this supplier
}

export const GYG_SUPPLIERS: GYGSupplier[] = [
  {
    id: 'avocado-mx',
    name: 'Hass Avocado (Michoacán, Mexico)',
    ingredient: 'avocado',
    origin: 'Mexico/Colombia',
    spend_share: 0.14,
    volatility: 'very_high',
    lead_time_days: 14,
    substituability: 'none',
    exposure_events: ['frost', 'drought', 'cartel-disruption', 'freight-delay', 'biosecurity-hold'],
  },
  {
    id: 'beef-au',
    name: 'Australian Beef Mince (East Coast)',
    ingredient: 'beef',
    origin: 'Australia (QLD/NSW)',
    spend_share: 0.22,
    volatility: 'medium',
    lead_time_days: 3,
    substituability: 'partial',
    exposure_events: ['drought', 'flooding-roads', 'abattoir-halt', 'east-coast-cattle-price-spike'],
  },
  {
    id: 'chicken-au',
    name: 'Free-Range Chicken Thigh (Inghams/Baiada)',
    ingredient: 'chicken',
    origin: 'Australia',
    spend_share: 0.18,
    volatility: 'low',
    lead_time_days: 2,
    substituability: 'partial',
    exposure_events: ['avian-influenza', 'processing-recall'],
  },
  {
    id: 'tortilla-mx',
    name: 'Corn Tortilla (Mexico/Texas)',
    ingredient: 'tortilla',
    origin: 'Mexico / USA',
    spend_share: 0.08,
    volatility: 'medium',
    lead_time_days: 21,
    substituability: 'partial',
    exposure_events: ['corn-price-spike', 'freight-delay', 'port-congestion'],
  },
  {
    id: 'jalapeno-mx',
    name: 'Jalapeño (Mexico)',
    ingredient: 'jalapeño',
    origin: 'Mexico',
    spend_share: 0.04,
    volatility: 'high',
    lead_time_days: 14,
    substituability: 'none',
    exposure_events: ['frost', 'drought', 'biosecurity-hold'],
  },
  {
    id: 'cheese-au',
    name: 'Cheddar/Jack Cheese (Australian)',
    ingredient: 'cheese',
    origin: 'Australia (VIC/SA)',
    spend_share: 0.09,
    volatility: 'low',
    lead_time_days: 5,
    substituability: 'full',
    exposure_events: ['dairy-recall'],
  },
  {
    id: 'packaging',
    name: 'Biodegradable Packaging (Malaysia/AU)',
    ingredient: 'packaging',
    origin: 'Malaysia / Australia',
    spend_share: 0.06,
    volatility: 'low',
    lead_time_days: 45,
    substituability: 'partial',
    exposure_events: ['port-congestion', 'freight-delay'],
  },
]

// ── Supply Chain Event Types ─────────────────────────────────────────────────

export type SupplyEventSeverity = 'watch' | 'moderate' | 'severe' | 'critical'

export interface SupplyChainEvent {
  id: string
  event_type: string
  description: string
  affected_suppliers: string[]       // supplier ids
  affected_ingredients: string[]
  severity: SupplyEventSeverity
  estimated_duration_weeks: number
  cost_impact_pct: number            // estimated % uplift on input cost basket (positive = cost rise)
  availability_impact_pct: number    // estimated % reduction in gross menu availability (0 = no impact)
  detected_at: string                // ISO-8601
  source: string                     // data source URL or description
  verified: boolean
}

// Current-period supply chain events (Jun 2026 — for demo)
export const GYG_CURRENT_EVENTS: SupplyChainEvent[] = [
  {
    id: 'sc-001',
    event_type: 'frost',
    description: 'Late-season frost event in Michoacán state (Mexico), primary Hass avocado growing region. Estimated 15–20% of flowering crop affected. Mexican Avocado Producers Association confirmed export volume reduction of ~18% for 4–6 weeks from 3 Jun 2026.',
    affected_suppliers: ['avocado-mx', 'jalapeno-mx'],
    affected_ingredients: ['avocado', 'jalapeño'],
    severity: 'severe',
    estimated_duration_weeks: 5,
    cost_impact_pct: 0.038,
    availability_impact_pct: 0.07,
    detected_at: '2026-06-03T09:00:00Z',
    source: 'https://www.avocadosfrommexico.com/industry/news/',
    verified: true,
  },
  {
    id: 'sc-002',
    event_type: 'east-coast-cattle-price-spike',
    description: 'East Coast Cattle Indicator (ECCI) spiked to 382¢/kg LW on 10 Jun 2026, up 14% from 30-day average (335¢/kg), driven by herd rebuilding post-2025 drought. GYG beef mince procurement locked at forward contract through Jul 2026, limiting immediate pass-through. Margin impact materialises at Q4 FY26 contract renewal.',
    affected_suppliers: ['beef-au'],
    affected_ingredients: ['beef'],
    severity: 'moderate',
    estimated_duration_weeks: 12,
    cost_impact_pct: 0.021,
    availability_impact_pct: 0.00,
    detected_at: '2026-06-10T14:30:00Z',
    source: 'https://www.mla.com.au/prices-markets/price-reporting/young-cattle/',
    verified: true,
  },
  {
    id: 'sc-003',
    event_type: 'port-congestion',
    description: 'Port of Melbourne container terminal congestion (stevedore industrial action, 22–27 Jun 2026). Tortilla and packaging shipments delayed 7–10 days. Australian Border Force biosecurity hold on 1 container of jalapeño (routine, not triggered by SC-001). VIC stores may reduce to limited menu for up to 2 days.',
    affected_suppliers: ['tortilla-mx', 'packaging', 'jalapeno-mx'],
    affected_ingredients: ['tortilla', 'packaging', 'jalapeño'],
    severity: 'moderate',
    estimated_duration_weeks: 2,
    cost_impact_pct: 0.004,
    availability_impact_pct: 0.04,
    detected_at: '2026-06-22T07:00:00Z',
    source: 'https://www.portofmelbourne.com/operational-updates/',
    verified: true,
  },
]

// ── Input Cost Index ─────────────────────────────────────────────────────────

export interface InputCostIndex {
  period: string
  base_index: number                 // 100 = FY25 average
  current_index: number
  change_pct: number
  components: Array<{
    ingredient: string
    weight: number                   // % of COGS
    current_price_index: number      // 100 = base
    change_pct: number
    event_driven: boolean
  }>
}

/** Compute an input cost index from current supply chain events. */
export function computeInputCostIndex(events: SupplyChainEvent[] = GYG_CURRENT_EVENTS): InputCostIndex {
  // Base weights from GYG_SUPPLIERS spend_share
  const components = GYG_SUPPLIERS.map((s) => {
    const relevantEvents = events.filter((e) => e.affected_suppliers.includes(s.id))
    const totalImpact = relevantEvents.reduce((acc, e) => acc + e.cost_impact_pct, 0)
    const currentIdx = 100 * (1 + totalImpact)
    return {
      ingredient: s.ingredient,
      weight: s.spend_share,
      current_price_index: Math.round(currentIdx * 100) / 100,
      change_pct: Math.round(totalImpact * 10000) / 100,
      event_driven: relevantEvents.length > 0,
    }
  })

  const currentIndex = components.reduce((acc, c) => acc + c.weight * c.current_price_index, 0) /
    components.reduce((acc, c) => acc + c.weight, 0)

  return {
    period: 'Jun 2026',
    base_index: 100,
    current_index: Math.round(currentIndex * 100) / 100,
    change_pct: Math.round((currentIndex - 100) * 100) / 100,
    components,
  }
}

// ── Gross Availability ────────────────────────────────────────────────────────

export interface GrossAvailabilitySignal {
  full_menu_pct: number             // % stores with all items available
  limited_menu_pct: number          // % stores running limited menu
  affected_items: string[]          // menu items potentially unavailable
  affected_regions: string[]        // which state/regions most impacted
  availability_drag_on_ft: number   // estimated % foot traffic reduction
}

/** Estimate gross menu availability from current supply events. */
export function computeGrossAvailability(events: SupplyChainEvent[] = GYG_CURRENT_EVENTS): GrossAvailabilitySignal {
  const totalAvailImpact = events.reduce((acc, e) => acc + e.availability_impact_pct, 0)
  const affectedItems = [...new Set(events.flatMap((e) => e.affected_ingredients))]

  // Regional impact: port-of-melbourne event hits VIC harder
  const affectedRegions: string[] = []
  if (events.some((e) => e.event_type === 'port-congestion')) affectedRegions.push('VIC')
  if (events.some((e) => e.event_type === 'frost')) affectedRegions.push('ALL')

  const limitedPct = Math.min(0.25, totalAvailImpact * 1.5)

  return {
    full_menu_pct: Math.round((1 - limitedPct) * 1000) / 10,
    limited_menu_pct: Math.round(limitedPct * 1000) / 10,
    affected_items: affectedItems,
    affected_regions: [...new Set(affectedRegions)],
    availability_drag_on_ft: Math.round(limitedPct * 0.6 * 1000) / 10,
  }
}

// ── Supply Chain Causal DAG ─────────────────────────────────────────────────

export const GYG_SUPPLY_CHAIN_DAG: CausalDAG = {
  name: 'gyg-supply',
  description: 'GYG supply chain shock → input cost + availability → LFL Revenue (natural experiment identification)',
  treatment: 'IC',
  outcome: 'LFL',
  nodes: [
    {
      id: 'SC',
      label: 'Supply Chain Event',
      type: 'exogenous',
      description: 'INSTRUMENT / EXOGENOUS SHOCK. Frost (Michoacán), cattle price spike (East Coast), port congestion (Melbourne). Exogenous to consumer demand — weather and stevedore action are orthogonal to foot traffic. Provides natural-experiment variation in input costs and gross availability.',
    },
    {
      id: 'MD',
      label: 'Market Demand',
      type: 'hidden',
      description: 'HIDDEN CONFOUNDER. Underlying consumer demand for Mexican-style QSR. Affects both the prices GYG can command (and thus input cost pass-through decisions) and foot traffic levels. Unobservable at weekly frequency — motivates SC as instrument.',
    },
    {
      id: 'IC',
      label: 'Input Cost Index',
      type: 'endogenous',
      description: 'Weighted ingredient cost basket (avocado 14%, beef 22%, chicken 18%, tortilla 8%, jalapeño 4%, cheese 9%, packaging 6%). The TREATMENT variable: we want to identify the causal effect of input cost shocks on LFL Revenue, isolated from demand-side confounding.',
    },
    {
      id: 'GA',
      label: 'Gross Availability',
      type: 'endogenous',
      description: 'Fraction of GYG locations with full menu availability. Supply disruptions (avocado shortage, tortilla delay) force some stores to run limited menu — avocado-heavy items (burrito bowls, nachos) removed. Limited menu → lower average ticket + potential customer substitution to competitors.',
    },
    {
      id: 'MPP',
      label: 'Menu Price Pressure',
      type: 'endogenous',
      description: 'Pass-through decision: does GYG raise menu prices in response to IC shocks? Historical pattern: GYG has passed through ~40% of cost increases above threshold (based on 4 prior ASX price announcements). Avocado spot spikes typically NOT passed through immediately — absorbed in margin for up to 4 weeks.',
    },
    {
      id: 'EFT',
      label: 'Effective Foot Traffic',
      type: 'endogenous',
      description: 'Foot traffic moderated by gross availability. GA reduction drags EFT below the IV-instrumented FT estimate. Some customers who find limited menu available choose not to return same visit. Estimated elasticity: −0.6× availability drag → foot traffic drag.',
    },
    {
      id: 'COGS',
      label: 'COGS % of Revenue',
      type: 'endogenous',
      description: 'Cost of goods as % of revenue — the gross margin driver. IC rises with SC events; if MPP = 0 (no pass-through), full IC increase hits COGS. If MPP > 0 (partial pass-through), customer counts may fall (demand elasticity), so COGS improves but revenue falls via EFT.',
    },
    {
      id: 'LFL',
      label: 'LFL Revenue',
      type: 'financial',
      description: 'Store like-for-like revenue. The OUTCOME. Affected by: (1) EFT × ATV (foot traffic × ticket); (2) MPP (price changes); (3) COGS (margin). Supply chain shocks enter through two paths: IC → MPP → ATV path; and SC → GA → EFT path. The natural-experiment design identifies both path coefficients from SC variation.',
    },
  ],
  edges: [
    { from: 'SC',  to: 'IC',   effect: 'positive',  label: 'shock raises input costs' },
    { from: 'SC',  to: 'GA',   effect: 'negative',  label: 'disruption reduces availability' },
    { from: 'MD',  to: 'IC',   latent: true,         label: 'demand-driven cost pressure' },
    { from: 'MD',  to: 'LFL',  latent: true,         label: 'demand drives revenue' },
    { from: 'IC',  to: 'MPP',  effect: 'positive',  label: 'cost pressure → price decision' },
    { from: 'IC',  to: 'COGS', effect: 'positive',  label: 'higher costs → higher COGS%' },
    { from: 'GA',  to: 'EFT',  effect: 'positive',  label: 'lower availability → less effective FT' },
    { from: 'MPP', to: 'EFT',  effect: 'negative',  label: 'price rises reduce visits' },
    { from: 'MPP', to: 'LFL',  effect: 'positive',  label: 'price effect on revenue' },
    { from: 'EFT', to: 'LFL',  effect: 'positive',  label: 'traffic drives revenue' },
    { from: 'COGS','to': 'LFL', effect: 'negative',  label: 'higher costs compress net' },
  ],
}

// ── Signal Summary ────────────────────────────────────────────────────────────

export interface SupplyChainSignal {
  period: string
  events: SupplyChainEvent[]
  input_cost: InputCostIndex
  availability: GrossAvailabilitySignal
  lfl_revision_pct: number           // net supply-chain-driven LFL revision (negative = headwind)
  margin_drag_pct: number            // gross margin headwind in bps
  confidence: number
  summary: string
}

/** Produce a consolidated supply chain signal for the current period. */
export function computeSupplyChainSignal(events: SupplyChainEvent[] = GYG_CURRENT_EVENTS): SupplyChainSignal {
  const input_cost = computeInputCostIndex(events)
  const availability = computeGrossAvailability(events)

  // Pass-through assumption: ~40% of input cost increase absorbed in price (GYG historical)
  // Remaining 60% hits margin
  const costPassThrough = 0.40
  const priceEffect = input_cost.change_pct * costPassThrough * 0.01   // % LFL uplift from price
  const marginDrag = input_cost.change_pct * (1 - costPassThrough)      // % margin drag (bps × 100)
  const ftDrag = availability.availability_drag_on_ft * -0.01           // % LFL drag from reduced availability
  const lflRevision = priceEffect + ftDrag                              // net effect

  const hasCritical = events.some((e) => e.severity === 'critical')
  const hasSevere = events.some((e) => e.severity === 'severe')
  const confidence = hasCritical ? 0.65 : hasSevere ? 0.76 : 0.83

  return {
    period: 'Jun 2026',
    events,
    input_cost,
    availability,
    lfl_revision_pct: Math.round(lflRevision * 10000) / 100,
    margin_drag_pct: Math.round(marginDrag * 100) / 100,
    confidence,
    summary:
      `Supply chain headwinds identified in Jun 2026: ` +
      `${events.filter((e) => e.severity === 'severe' || e.severity === 'critical').length} severe events. ` +
      `Input cost index at ${input_cost.current_index.toFixed(1)} (base 100). ` +
      `Avocado frost (Michoacán) is dominant risk: ${input_cost.components.find((c) => c.ingredient === 'avocado')?.change_pct ?? 0}% cost uplift. ` +
      `Net LFL revision from supply chain: ${lflRevision >= 0 ? '+' : ''}${(lflRevision * 100).toFixed(1)}pp. ` +
      `Gross margin drag: −${marginDrag.toFixed(1)}bp. ` +
      `${availability.limited_menu_pct}% of stores on limited menu (avocado items).`,
  }
}
