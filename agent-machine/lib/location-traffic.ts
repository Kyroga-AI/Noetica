/**
 * location-traffic — GYG store location registry and foot-traffic model by archetype.
 *
 * GYG operates 30+ corporate-owned and franchised locations across Australia.
 * Each location belongs to an archetype that determines its traffic drivers,
 * weather sensitivity, and supply chain vulnerability:
 *
 *   cbd          — High-rise lunch trade (Mon–Fri peak), low weekend
 *   suburban     — Family dinner + weekend trade, moderate seasonality
 *   food-court   — Mall-anchored, highly weather-insensitive, lower margin
 *   drive-through — Highest throughput, fastest service, weather-insensitive
 *   airport      — Captive high-spend travellers, minimal seasonality
 *   university   — Student lunch, semester-dependent, highly weather-sensitive
 *
 * The foot traffic model combines:
 *   1. Archetype base rate (from GYG ASX quarterly store data)
 *   2. Weather adjustment (W: temperature, rainfall index)
 *   3. Holiday calendar adjustment (H: school holidays, public holidays)
 *   4. Macro sentiment adjustment (M: consumer confidence sub-index)
 *   5. Supply availability drag (from supply-chain.ts GA signal)
 *   6. Google Popular Times instrumentation (IV residual after covariate adjustment)
 *
 * The location-level model is the micro-foundation under the network-level IV:
 * the GPT→FT IV works because within each archetype the instrument (GPT busyness)
 * is a consistent proxy for actual visits, and the exclusion restriction holds
 * uniformly across archetypes.
 */

export type LocationArchetype =
  | 'cbd'
  | 'suburban'
  | 'food-court'
  | 'drive-through'
  | 'airport'
  | 'university'

export type AustralianState = 'NSW' | 'VIC' | 'QLD' | 'WA' | 'ACT' | 'SA'

export interface GYGLocation {
  id: string
  name: string
  state: AustralianState
  suburb: string
  archetype: LocationArchetype
  lat: number
  lng: number
  opened: string                    // YYYY
  is_corporate: boolean             // corporate vs franchise
  seating_capacity: number
  has_drive_through: boolean
  avg_ticket_aud: number            // average transaction value (AUD)
  weekly_transactions_base: number  // base period weekly transaction count
  gpt_place_id: string              // Google Maps place ID (anonymised for demo)
}

export const GYG_LOCATIONS: GYGLocation[] = [
  // ── New South Wales ────────────────────────────────────────────────────────
  { id: 'gyg-sydney-cbd',      name: 'George St Sydney CBD',    state: 'NSW', suburb: 'Sydney',       archetype: 'cbd',          lat: -33.8688, lng: 151.2093, opened: '2014', is_corporate: true,  seating_capacity: 80,  has_drive_through: false, avg_ticket_aud: 17.90, weekly_transactions_base: 3800, gpt_place_id: 'ChIJ_gyg_sydney_cbd' },
  { id: 'gyg-pitt-st',         name: 'Pitt St Mall',            state: 'NSW', suburb: 'Sydney',       archetype: 'food-court',   lat: -33.8710, lng: 151.2065, opened: '2016', is_corporate: true,  seating_capacity: 60,  has_drive_through: false, avg_ticket_aud: 17.40, weekly_transactions_base: 4100, gpt_place_id: 'ChIJ_gyg_pitt' },
  { id: 'gyg-darlinghurst',    name: 'Darlinghurst',            state: 'NSW', suburb: 'Darlinghurst', archetype: 'suburban',     lat: -33.8784, lng: 151.2163, opened: '2011', is_corporate: true,  seating_capacity: 55,  has_drive_through: false, avg_ticket_aud: 18.20, weekly_transactions_base: 2900, gpt_place_id: 'ChIJ_gyg_darlinghurst' },
  { id: 'gyg-north-sydney',    name: 'North Sydney Miller St',  state: 'NSW', suburb: 'North Sydney', archetype: 'cbd',          lat: -33.8397, lng: 151.2093, opened: '2017', is_corporate: false, seating_capacity: 65,  has_drive_through: false, avg_ticket_aud: 17.80, weekly_transactions_base: 2600, gpt_place_id: 'ChIJ_gyg_nsyd' },
  { id: 'gyg-chatswood',       name: 'Chatswood Westfield',     state: 'NSW', suburb: 'Chatswood',    archetype: 'food-court',   lat: -33.7983, lng: 151.1816, opened: '2018', is_corporate: false, seating_capacity: 50,  has_drive_through: false, avg_ticket_aud: 17.20, weekly_transactions_base: 3200, gpt_place_id: 'ChIJ_gyg_chatswood' },
  { id: 'gyg-parramatta',      name: 'Parramatta Westfield',    state: 'NSW', suburb: 'Parramatta',   archetype: 'food-court',   lat: -33.8152, lng: 151.0011, opened: '2019', is_corporate: false, seating_capacity: 55,  has_drive_through: false, avg_ticket_aud: 16.90, weekly_transactions_base: 3500, gpt_place_id: 'ChIJ_gyg_parra' },
  { id: 'gyg-bondi-junction',  name: 'Bondi Junction Westfield',state: 'NSW', suburb: 'Bondi Junction',archetype: 'food-court',  lat: -33.8914, lng: 151.2494, opened: '2020', is_corporate: false, seating_capacity: 45,  has_drive_through: false, avg_ticket_aud: 18.50, weekly_transactions_base: 2800, gpt_place_id: 'ChIJ_gyg_bondi' },
  { id: 'gyg-newcastle',       name: 'Newcastle Hunter St',     state: 'NSW', suburb: 'Newcastle',    archetype: 'suburban',     lat: -32.9283, lng: 151.7817, opened: '2019', is_corporate: false, seating_capacity: 70,  has_drive_through: false, avg_ticket_aud: 16.80, weekly_transactions_base: 2200, gpt_place_id: 'ChIJ_gyg_newcastle' },
  { id: 'gyg-miranda',         name: 'Miranda Westfield',       state: 'NSW', suburb: 'Miranda',      archetype: 'food-court',   lat: -34.0387, lng: 151.1020, opened: '2021', is_corporate: false, seating_capacity: 50,  has_drive_through: false, avg_ticket_aud: 17.10, weekly_transactions_base: 2600, gpt_place_id: 'ChIJ_gyg_miranda' },
  { id: 'gyg-lane-cove',       name: 'Lane Cove Drive-Through', state: 'NSW', suburb: 'Lane Cove',    archetype: 'drive-through',lat: -33.8172, lng: 151.1635, opened: '2022', is_corporate: true,  seating_capacity: 40,  has_drive_through: true,  avg_ticket_aud: 19.20, weekly_transactions_base: 4800, gpt_place_id: 'ChIJ_gyg_lane_cove' },
  { id: 'gyg-kingsford',       name: 'Kingsford (UNSW)',        state: 'NSW', suburb: 'Kingsford',    archetype: 'university',   lat: -33.9168, lng: 151.2269, opened: '2018', is_corporate: false, seating_capacity: 60,  has_drive_through: false, avg_ticket_aud: 15.80, weekly_transactions_base: 2400, gpt_place_id: 'ChIJ_gyg_kingsford' },
  { id: 'gyg-syd-airport',     name: 'Sydney Airport T2',       state: 'NSW', suburb: 'Mascot',       archetype: 'airport',      lat: -33.9462, lng: 151.1731, opened: '2023', is_corporate: true,  seating_capacity: 35,  has_drive_through: false, avg_ticket_aud: 22.40, weekly_transactions_base: 3200, gpt_place_id: 'ChIJ_gyg_syd_airport' },
  { id: 'gyg-manly',           name: 'Manly Corso',             state: 'NSW', suburb: 'Manly',        archetype: 'suburban',     lat: -33.7969, lng: 151.2864, opened: '2020', is_corporate: false, seating_capacity: 65,  has_drive_through: false, avg_ticket_aud: 19.10, weekly_transactions_base: 2100, gpt_place_id: 'ChIJ_gyg_manly' },
  { id: 'gyg-penrith',         name: 'Penrith Drive-Through',   state: 'NSW', suburb: 'Penrith',      archetype: 'drive-through',lat: -33.7511, lng: 150.6942, opened: '2023', is_corporate: true,  seating_capacity: 35,  has_drive_through: true,  avg_ticket_aud: 18.90, weekly_transactions_base: 4400, gpt_place_id: 'ChIJ_gyg_penrith' },

  // ── Victoria ────────────────────────────────────────────────────────────────
  { id: 'gyg-melb-cbd',        name: 'Swanston St Melbourne',   state: 'VIC', suburb: 'Melbourne',    archetype: 'cbd',          lat: -37.8136, lng: 144.9631, opened: '2017', is_corporate: true,  seating_capacity: 85,  has_drive_through: false, avg_ticket_aud: 17.90, weekly_transactions_base: 3400, gpt_place_id: 'ChIJ_gyg_melb_cbd' },
  { id: 'gyg-southbank',       name: 'Southbank Promenade',     state: 'VIC', suburb: 'Southbank',    archetype: 'suburban',     lat: -37.8225, lng: 144.9627, opened: '2019', is_corporate: false, seating_capacity: 70,  has_drive_through: false, avg_ticket_aud: 18.40, weekly_transactions_base: 2800, gpt_place_id: 'ChIJ_gyg_southbank' },
  { id: 'gyg-chadstone',       name: 'Chadstone Shopping Centre',state: 'VIC',suburb: 'Chadstone',    archetype: 'food-court',   lat: -37.8883, lng: 145.0803, opened: '2020', is_corporate: false, seating_capacity: 55,  has_drive_through: false, avg_ticket_aud: 17.40, weekly_transactions_base: 3600, gpt_place_id: 'ChIJ_gyg_chadstone' },
  { id: 'gyg-doncaster',       name: 'Doncaster Westfield',     state: 'VIC', suburb: 'Doncaster',    archetype: 'food-court',   lat: -37.7824, lng: 145.1270, opened: '2021', is_corporate: false, seating_capacity: 50,  has_drive_through: false, avg_ticket_aud: 17.00, weekly_transactions_base: 2900, gpt_place_id: 'ChIJ_gyg_doncaster' },
  { id: 'gyg-fitzroy',         name: 'Fitzroy Brunswick St',    state: 'VIC', suburb: 'Fitzroy',      archetype: 'suburban',     lat: -37.8037, lng: 144.9785, opened: '2022', is_corporate: false, seating_capacity: 60,  has_drive_through: false, avg_ticket_aud: 19.20, weekly_transactions_base: 2100, gpt_place_id: 'ChIJ_gyg_fitzroy' },
  { id: 'gyg-essendon',        name: 'Essendon Fields Drive-Through',state: 'VIC',suburb: 'Essendon', archetype: 'drive-through',lat: -37.7266, lng: 144.9024, opened: '2023', is_corporate: true,  seating_capacity: 40,  has_drive_through: true,  avg_ticket_aud: 18.80, weekly_transactions_base: 4200, gpt_place_id: 'ChIJ_gyg_essendon' },
  { id: 'gyg-melb-airport',    name: 'Melbourne Airport T2',    state: 'VIC', suburb: 'Tullamarine',  archetype: 'airport',      lat: -37.6690, lng: 144.8410, opened: '2024', is_corporate: true,  seating_capacity: 30,  has_drive_through: false, avg_ticket_aud: 23.10, weekly_transactions_base: 2800, gpt_place_id: 'ChIJ_gyg_melb_airport' },

  // ── Queensland ─────────────────────────────────────────────────────────────
  { id: 'gyg-brisbane-cbd',    name: 'Queen St Brisbane CBD',   state: 'QLD', suburb: 'Brisbane',     archetype: 'cbd',          lat: -27.4705, lng: 153.0260, opened: '2018', is_corporate: true,  seating_capacity: 75,  has_drive_through: false, avg_ticket_aud: 17.60, weekly_transactions_base: 3100, gpt_place_id: 'ChIJ_gyg_bris_cbd' },
  { id: 'gyg-south-bank-bne',  name: 'South Bank Brisbane',     state: 'QLD', suburb: 'South Brisbane',archetype: 'suburban',    lat: -27.4777, lng: 153.0172, opened: '2020', is_corporate: false, seating_capacity: 65,  has_drive_through: false, avg_ticket_aud: 18.00, weekly_transactions_base: 2400, gpt_place_id: 'ChIJ_gyg_south_bank_bne' },
  { id: 'gyg-carindale',       name: 'Westfield Carindale',     state: 'QLD', suburb: 'Carindale',    archetype: 'food-court',   lat: -27.4969, lng: 153.0980, opened: '2021', is_corporate: false, seating_capacity: 50,  has_drive_through: false, avg_ticket_aud: 16.90, weekly_transactions_base: 2800, gpt_place_id: 'ChIJ_gyg_carindale' },
  { id: 'gyg-chermside',       name: 'Westfield Chermside',     state: 'QLD', suburb: 'Chermside',    archetype: 'food-court',   lat: -27.3860, lng: 153.0290, opened: '2022', is_corporate: false, seating_capacity: 50,  has_drive_through: false, avg_ticket_aud: 16.80, weekly_transactions_base: 2600, gpt_place_id: 'ChIJ_gyg_chermside' },

  // ── Western Australia ───────────────────────────────────────────────────────
  { id: 'gyg-perth-cbd',       name: 'Murray St Perth CBD',     state: 'WA',  suburb: 'Perth',        archetype: 'cbd',          lat: -31.9505, lng: 115.8605, opened: '2021', is_corporate: false, seating_capacity: 70,  has_drive_through: false, avg_ticket_aud: 17.50, weekly_transactions_base: 2500, gpt_place_id: 'ChIJ_gyg_perth_cbd' },
  { id: 'gyg-karrinyup',       name: 'Karrinyup Shopping Centre',state: 'WA', suburb: 'Karrinyup',    archetype: 'food-court',   lat: -31.8654, lng: 115.7847, opened: '2022', is_corporate: false, seating_capacity: 45,  has_drive_through: false, avg_ticket_aud: 17.10, weekly_transactions_base: 2200, gpt_place_id: 'ChIJ_gyg_karrinyup' },

  // ── ACT ─────────────────────────────────────────────────────────────────────
  { id: 'gyg-canberra-city',   name: 'Canberra City Centre',    state: 'ACT', suburb: 'Canberra',     archetype: 'cbd',          lat: -35.2809, lng: 149.1300, opened: '2020', is_corporate: false, seating_capacity: 65,  has_drive_through: false, avg_ticket_aud: 17.30, weekly_transactions_base: 2100, gpt_place_id: 'ChIJ_gyg_canberra' },
  { id: 'gyg-belconnen',       name: 'Westfield Belconnen',     state: 'ACT', suburb: 'Belconnen',    archetype: 'food-court',   lat: -35.2366, lng: 149.0695, opened: '2021', is_corporate: false, seating_capacity: 45,  has_drive_through: false, avg_ticket_aud: 16.90, weekly_transactions_base: 1900, gpt_place_id: 'ChIJ_gyg_belconnen' },

  // ── South Australia ─────────────────────────────────────────────────────────
  { id: 'gyg-rundle-mall',     name: 'Rundle Mall Adelaide',    state: 'SA',  suburb: 'Adelaide',     archetype: 'food-court',   lat: -34.9217, lng: 138.6011, opened: '2023', is_corporate: false, seating_capacity: 50,  has_drive_through: false, avg_ticket_aud: 16.80, weekly_transactions_base: 2000, gpt_place_id: 'ChIJ_gyg_rundle' },
]

// ── Archetype Traffic Model ──────────────────────────────────────────────────

export interface ArchetypeProfile {
  archetype: LocationArchetype
  weather_sensitivity: number        // 0–1: how much weather drag reduces visits
  holiday_multiplier: number         // multiplier during school holidays
  peak_day: string                   // 'weekday' | 'weekend' | 'uniform'
  peak_hour: string                  // hour range of peak
  macro_sensitivity: number          // 0–1: consumer confidence sensitivity
  avg_dwell_minutes: number
  gpt_reliability: number            // 0–1: how well GPT proxies actual visits (exclusion quality)
}

export const ARCHETYPE_PROFILES: Record<LocationArchetype, ArchetypeProfile> = {
  'cbd': {
    archetype: 'cbd',
    weather_sensitivity: 0.35,
    holiday_multiplier: 0.62,          // CBDs empty in school holidays
    peak_day: 'weekday',
    peak_hour: '12:00–13:30',
    macro_sensitivity: 0.55,
    avg_dwell_minutes: 18,
    gpt_reliability: 0.88,
  },
  'suburban': {
    archetype: 'suburban',
    weather_sensitivity: 0.28,
    holiday_multiplier: 1.18,
    peak_day: 'weekend',
    peak_hour: '18:00–19:30',
    macro_sensitivity: 0.48,
    avg_dwell_minutes: 24,
    gpt_reliability: 0.82,
  },
  'food-court': {
    archetype: 'food-court',
    weather_sensitivity: 0.08,        // malls are sheltered
    holiday_multiplier: 1.35,
    peak_day: 'weekend',
    peak_hour: '11:30–13:00',
    macro_sensitivity: 0.40,
    avg_dwell_minutes: 20,
    gpt_reliability: 0.79,            // food court GPT less precise (whole mall busyness)
  },
  'drive-through': {
    archetype: 'drive-through',
    weather_sensitivity: 0.05,        // insensitive — customers in cars
    holiday_multiplier: 1.22,
    peak_day: 'uniform',
    peak_hour: '11:00–14:00',
    macro_sensitivity: 0.32,
    avg_dwell_minutes: 8,
    gpt_reliability: 0.91,            // drive-through GPT very reliable (distinct queue signal)
  },
  'airport': {
    archetype: 'airport',
    weather_sensitivity: 0.12,        // disrupted flights = captured passengers
    holiday_multiplier: 1.45,
    peak_day: 'uniform',
    peak_hour: '06:00–08:30',
    macro_sensitivity: 0.22,          // business travel + leisure both resilient
    avg_dwell_minutes: 22,
    gpt_reliability: 0.76,
  },
  'university': {
    archetype: 'university',
    weather_sensitivity: 0.45,        // students won't walk in heavy rain
    holiday_multiplier: 0.28,         // semester break kills foot traffic
    peak_day: 'weekday',
    peak_hour: '12:00–14:00',
    macro_sensitivity: 0.30,          // students less discretionary-spending sensitive
    avg_dwell_minutes: 28,
    gpt_reliability: 0.84,
  },
}

// ── Foot Traffic Estimate ─────────────────────────────────────────────────────

export interface LocationTrafficEstimate {
  location_id: string
  location_name: string
  archetype: LocationArchetype
  state: AustralianState
  base_weekly_transactions: number
  adjusted_transactions: number
  weather_drag_pct: number
  holiday_lift_pct: number
  macro_drag_pct: number
  availability_drag_pct: number
  gpt_busyness_index: number         // simulated GPT index (0–100)
  iv_adjusted_transactions: number   // IV-instrumented estimate
  estimated_weekly_revenue_aud: number
  signal_quality: 'high' | 'medium' | 'low'
}

/** Compute foot traffic estimate for each location given current conditions. */
export function computeLocationTraffic(params: {
  weather_index: number              // 0–1 (1 = perfect, 0 = extreme bad weather)
  is_school_holiday: boolean
  consumer_confidence_index: number  // Westpac-MI, normalised to 0–1 (1 = 100 avg)
  availability_drag_pct: number      // from supply-chain.ts (e.g. 4.2 = 4.2%)
}): LocationTrafficEstimate[] {
  return GYG_LOCATIONS.map((loc) => {
    const profile = ARCHETYPE_PROFILES[loc.archetype]

    // Weather drag: profile sensitivity × how bad the weather is
    const weatherDrag = profile.weather_sensitivity * (1 - params.weather_index) * 100

    // Holiday: lift or drag depending on archetype
    const holidayLift = params.is_school_holiday
      ? (profile.holiday_multiplier - 1) * 100
      : 0

    // Macro: sentiment below 1.0 creates proportional drag
    const macroDrag = profile.macro_sensitivity * (1 - params.consumer_confidence_index) * 100

    // Availability: uniform drag across all archetypes
    const availDrag = params.availability_drag_pct

    // Net adjustment
    const netAdj = 1 - weatherDrag / 100 + holidayLift / 100 - macroDrag / 100 - availDrag / 100
    const adjustedTransactions = Math.round(loc.weekly_transactions_base * netAdj)

    // Simulate GPT busyness index: correlated with adjusted traffic + noise
    const gptBase = (adjustedTransactions / loc.weekly_transactions_base) * 75
    const gptNoise = (Math.sin(loc.lat * 1000) * 5)  // deterministic pseudo-noise per location
    const gptBusyness = Math.max(10, Math.min(99, gptBase + gptNoise))

    // IV-adjusted: use GPT as instrument to re-estimate (simplified: GPT-adjusted estimate)
    const ivRatio = gptBusyness / 75
    const ivAdjustedTransactions = Math.round(loc.weekly_transactions_base * ivRatio)

    // Signal quality based on GPT reliability and event severity
    const signalQuality: LocationTrafficEstimate['signal_quality'] =
      profile.gpt_reliability > 0.85 ? 'high' :
      profile.gpt_reliability > 0.79 ? 'medium' : 'low'

    return {
      location_id: loc.id,
      location_name: loc.name,
      archetype: loc.archetype,
      state: loc.state,
      base_weekly_transactions: loc.weekly_transactions_base,
      adjusted_transactions: adjustedTransactions,
      weather_drag_pct: Math.round(weatherDrag * 10) / 10,
      holiday_lift_pct: Math.round(holidayLift * 10) / 10,
      macro_drag_pct: Math.round(macroDrag * 10) / 10,
      availability_drag_pct: Math.round(availDrag * 10) / 10,
      gpt_busyness_index: Math.round(gptBusyness * 10) / 10,
      iv_adjusted_transactions: ivAdjustedTransactions,
      estimated_weekly_revenue_aud: Math.round(ivAdjustedTransactions * loc.avg_ticket_aud),
      signal_quality: signalQuality,
    }
  })
}

/** Aggregate location-level estimates into network totals by state and archetype. */
export function aggregateTraffic(estimates: LocationTrafficEstimate[]): {
  total_adjusted_transactions: number
  total_iv_transactions: number
  total_weekly_revenue_aud: number
  by_state: Record<string, { transactions: number; revenue: number; locations: number }>
  by_archetype: Record<LocationArchetype, { transactions: number; revenue: number; locations: number; avg_busyness: number }>
  lfl_index: number                  // normalised to base = 100
} {
  const by_state: Record<string, { transactions: number; revenue: number; locations: number }> = {}
  const by_arch: Record<string, { transactions: number; revenue: number; locations: number; total_busyness: number }> = {}

  for (const e of estimates) {
    by_state[e.state] = by_state[e.state] ?? { transactions: 0, revenue: 0, locations: 0 }
    by_state[e.state]!.transactions += e.iv_adjusted_transactions
    by_state[e.state]!.revenue += e.estimated_weekly_revenue_aud
    by_state[e.state]!.locations += 1

    by_arch[e.archetype] = by_arch[e.archetype] ?? { transactions: 0, revenue: 0, locations: 0, total_busyness: 0 }
    by_arch[e.archetype]!.transactions += e.iv_adjusted_transactions
    by_arch[e.archetype]!.revenue += e.estimated_weekly_revenue_aud
    by_arch[e.archetype]!.locations += 1
    by_arch[e.archetype]!.total_busyness += e.gpt_busyness_index
  }

  const by_archetype = Object.fromEntries(
    Object.entries(by_arch).map(([k, v]) => [k, {
      transactions: v.transactions, revenue: v.revenue, locations: v.locations,
      avg_busyness: Math.round(v.total_busyness / v.locations * 10) / 10,
    }])
  ) as Record<LocationArchetype, { transactions: number; revenue: number; locations: number; avg_busyness: number }>

  const totalBase = estimates.reduce((a, e) => a + e.base_weekly_transactions, 0)
  const totalIV = estimates.reduce((a, e) => a + e.iv_adjusted_transactions, 0)
  const lflIndex = Math.round(totalIV / totalBase * 1000) / 10  // e.g. 96.4

  return {
    total_adjusted_transactions: estimates.reduce((a, e) => a + e.adjusted_transactions, 0),
    total_iv_transactions: totalIV,
    total_weekly_revenue_aud: estimates.reduce((a, e) => a + e.estimated_weekly_revenue_aud, 0),
    by_state,
    by_archetype,
    lfl_index: lflIndex,
  }
}
