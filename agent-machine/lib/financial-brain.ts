/**
 * financial-brain — project the Claude financial-services plugin catalog into HellGraph
 * as FinancialDomain + FinancialSkill atoms, so the Knowledge lens shows real financial
 * domain structure (7 domains, 30+ skills) on a fresh install or for a client demo.
 *
 * Catalog sourced from SocioProphet/financial-services (forked Jun 2026):
 * plugins/vertical-plugins/{equity-research,investment-banking,financial-analysis,...}
 * Idempotent — no-op if FinancialSkill nodes already present.
 */
import { getHellGraph } from '@socioprophet/hellgraph'

const FINANCIAL_CATALOG: Array<{
  domain: string
  label: string
  skills: Array<{ id: string; label: string; description: string }>
}> = [
  {
    domain: 'equity-research',
    label: 'Equity Research',
    skills: [
      { id: 'thesis-tracker', label: 'Thesis Tracker', description: 'Maintain and update investment theses; track key data points, catalysts, and thesis milestones over time. Supports falsifiable thesis structure, pillar scorecards, and catalyst calendars.' },
      { id: 'earnings-analysis', label: 'Earnings Analysis', description: 'Post-earnings update reports (8–12 pages): beat/miss analysis, revised estimates, thesis impact, and updated price target. Fast-turnaround format (24–48hr).' },
      { id: 'earnings-preview', label: 'Earnings Preview', description: 'Pre-earnings briefing with consensus estimates, key metrics to watch, and options market positioning.' },
      { id: 'idea-generation', label: 'Idea Generation', description: 'Generate long/short investment ideas using fundamental and quantitative screens, sector rotation signals, and technical setup analysis.' },
      { id: 'initiating-coverage', label: 'Initiating Coverage', description: 'Full 30–50 page initiation of coverage report with investment thesis, business model, financial model, and valuation.' },
      { id: 'model-update', label: 'Model Update', description: 'Update financial model estimates after new data points, guidance changes, or macro shifts.' },
      { id: 'morning-note', label: 'Morning Note', description: 'Daily morning briefing: overnight market moves, key macro data releases, and implications for portfolio names.' },
      { id: 'sector-overview', label: 'Sector Overview', description: 'Sector-level analysis: competitive dynamics, industry trends, peer relative valuations, and thematic catalysts.' },
      { id: 'catalyst-calendar', label: 'Catalyst Calendar', description: 'Track upcoming catalysts across portfolio names: earnings dates, regulatory decisions, product launches, macro events.' },
    ],
  },
  {
    domain: 'investment-banking',
    label: 'Investment Banking',
    skills: [
      { id: 'pitch-deck', label: 'Pitch Deck', description: 'Create pitchbooks for client mandates: M&A advisory, equity capital markets, debt capital markets, and restructuring.' },
      { id: 'cim-builder', label: 'CIM Builder', description: 'Confidential Information Memoranda for M&A sell-side processes: business overview, financial highlights, growth thesis.' },
      { id: 'merger-model', label: 'Merger Model', description: 'LBO and merger accretion/dilution models: entry/exit assumptions, returns analysis, and sensitivity tables.' },
      { id: 'buyer-list', label: 'Buyer List', description: 'Build strategic and financial buyer lists for M&A sell-side processes with rationale and contact strategy.' },
      { id: 'deal-tracker', label: 'Deal Tracker', description: 'Track live M&A deal progress, bid milestones, counterparty status, and next steps across multiple processes.' },
      { id: 'teaser', label: 'Teaser', description: 'Anonymous one-page teasers for initial buyer outreach in sell-side M&A processes.' },
      { id: 'process-letter', label: 'Process Letter', description: 'Draft process letters and bid instructions for structured M&A auction processes.' },
      { id: 'strip-profile', label: 'Strip Profile', description: 'One-page company profiles for deal marketing, quick reference, and buyer outreach.' },
      { id: 'datapack-builder', label: 'Datapack Builder', description: 'Management presentation and data packs for buyer due diligence in M&A processes.' },
    ],
  },
  {
    domain: 'financial-analysis',
    label: 'Financial Analysis',
    skills: [
      { id: 'dcf-valuation', label: 'DCF Valuation', description: 'Discounted cash flow valuation: free cash flow projection, WACC calculation, terminal value, and sensitivity tables.' },
      { id: 'comparable-analysis', label: 'Comparable Analysis', description: 'Trading comps (EV/EBITDA, P/E, EV/Sales) and transaction comps for relative valuation.' },
      { id: 'scenario-modeling', label: 'Scenario Modeling', description: 'Base/bull/bear scenario models with sensitivity analysis and Monte Carlo simulation.' },
      { id: 'ratio-analysis', label: 'Ratio Analysis', description: 'Financial ratio computation and interpretation: liquidity, profitability, leverage, efficiency, and market metrics.' },
    ],
  },
  {
    domain: 'private-equity',
    label: 'Private Equity',
    skills: [
      { id: 'lbo-model', label: 'LBO Model', description: 'Leveraged buyout financial model: debt structuring, returns waterfall, management incentive plan, and exit analysis.' },
      { id: 'portfolio-monitoring', label: 'Portfolio Monitoring', description: 'Track KPIs, financial covenants, and strategic milestones across portfolio companies; generate board reporting.' },
      { id: 'value-creation', label: 'Value Creation Plan', description: '100-day plan and 3-year value creation roadmap for portfolio companies post-acquisition.' },
    ],
  },
  {
    domain: 'wealth-management',
    label: 'Wealth Management',
    skills: [
      { id: 'portfolio-review', label: 'Portfolio Review', description: 'Quarterly portfolio performance review with attribution, factor exposure, risk metrics, and rebalancing recommendations.' },
      { id: 'ips-builder', label: 'IPS Builder', description: 'Draft Investment Policy Statements aligned to client objectives, risk tolerance, liquidity needs, and tax considerations.' },
      { id: 'estate-planning', label: 'Estate Planning Analysis', description: 'Analyse estate planning structures: family trusts, gifting strategies, tax optimisation, inter-generational wealth transfer.' },
    ],
  },
  {
    domain: 'fund-admin',
    label: 'Fund Administration',
    skills: [
      { id: 'nav-calculation', label: 'NAV Calculation', description: 'Calculate net asset value for investment funds across asset classes with fair value pricing.' },
      { id: 'investor-reporting', label: 'Investor Reporting', description: 'Quarterly and annual investor letters, performance attribution, and capital account statements.' },
      { id: 'capital-account', label: 'Capital Account', description: 'Maintain LP capital account statements and distribution waterfall calculations.' },
    ],
  },
  {
    domain: 'operations',
    label: 'Financial Operations',
    skills: [
      { id: 'reconciliation', label: 'Reconciliation', description: 'Portfolio and account reconciliation: position breaks, cash breaks, and corporate action processing.' },
      { id: 'trade-settlement', label: 'Trade Settlement', description: 'Trade settlement tracking, fails management, and regulatory transaction reporting.' },
    ],
  },
]

/** Project the financial-services plugin catalog into HellGraph. Idempotent. */
export function projectFinancialBrain(): { domains: number; skills: number } {
  const g = getHellGraph()
  if (g.nodesByLabel('FinancialSkill').length > 0) return { domains: 0, skills: 0 }
  const now = new Date().toISOString()
  let domains = 0, skills = 0
  for (const { domain, label, skills: domainSkills } of FINANCIAL_CATALOG) {
    const domainId = `urn:noetica:financial:domain:${domain}`
    try {
      g.addNode(domainId, ['FinancialDomain'], {
        name: label, surface: label, domain,
        source: 'financial-services-plugin', created_at: now,
      })
      domains++
    } catch { continue }
    for (const skill of domainSkills) {
      const skillId = `urn:noetica:financial:skill:${domain}:${skill.id}`
      try {
        g.addNode(skillId, ['FinancialSkill'], {
          name: skill.label, surface: skill.label, domain,
          skill_id: skill.id, description: skill.description,
          source: 'financial-services-plugin', created_at: now,
        })
        skills++
      } catch { continue }
      try { g.addEdge('HAS_SKILL', domainId, skillId, { kind: 'financial' }) } catch { /* */ }
    }
  }
  return { domains, skills }
}

/** Return the full financial skill catalog as a flat list (for API + tool responses). */
export function financialSkillCatalog(): Array<{ domain: string; domainLabel: string; skillId: string; label: string; description: string }> {
  return FINANCIAL_CATALOG.flatMap(({ domain, label: domainLabel, skills }) =>
    skills.map((s) => ({ domain, domainLabel, skillId: s.id, label: s.label, description: s.description }))
  )
}
