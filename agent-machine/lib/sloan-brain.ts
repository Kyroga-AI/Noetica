/**
 * sloan-brain — project MIT Sloan School of Management courses into HellGraph as
 * SloanField + SloanCourse atoms, adding business/finance/strategy knowledge to the
 * Knowledge lens alongside the STEM academic brain.
 *
 * Covers the 15.xxx series (Finance, Accounting, Strategy, Analytics, Operations, FinTech)
 * plus the Economics (14.xxx) courses taught collaboratively with Sloan. Selected for
 * relevance to the buy-side asset management use case (IFM Investors demo).
 *
 * Mirrors academic-graph.ts pattern: idempotent, no-op if SloanCourse nodes present.
 */
import { getHellGraph } from '@socioprophet/hellgraph'

const SLOAN_CATALOG: Array<{
  field: string
  label: string
  courses: Array<{ code: string; title: string; description: string }>
}> = [
  {
    field: 'finance',
    label: 'Finance',
    courses: [
      { code: '15.401', title: 'Finance Theory I', description: 'Foundations of financial economics: present value, capital budgeting, risk and return, CAPM, portfolio theory, market efficiency, and the fundamental theorem of asset pricing.' },
      { code: '15.402', title: 'Finance Theory II', description: 'Advanced corporate finance: capital structure (Modigliani-Miller), payout policy, agency costs, information asymmetry, derivatives, real options, and risk management.' },
      { code: '15.414', title: 'Financial Management', description: 'Applied corporate finance: DCF valuation, M&A analysis, capital structure decisions, working capital management, and the CFO toolkit.' },
      { code: '15.433', title: 'Investments', description: 'Portfolio management, factor models, asset pricing anomalies, fixed income, derivatives, hedge fund strategies, and alternative investments.' },
      { code: '15.434', title: 'Advanced Corporate Finance', description: 'Leveraged buyouts, venture capital deal structures, restructuring, distressed debt, and private equity return attribution.' },
      { code: '15.437', title: 'Options and Futures Markets', description: 'Options pricing (Black-Scholes-Merton), binomial trees, futures markets, hedging strategies, volatility surface, and exotic derivatives.' },
      { code: '15.438', title: 'Fixed Income Securities', description: 'Bond pricing, duration, convexity, yield curve modeling (Nelson-Siegel, HJM), credit risk, CDS, and structured products (MBS, CDO).' },
      { code: '15.450', title: 'Analytics of Finance', description: 'Quantitative methods: statistical arbitrage, factor models (Fama-French), ML in investing, algorithmic trading, and empirical asset pricing.' },
      { code: '15.415', title: 'Venture Capital and Private Equity', description: 'VC/PE fund structure, deal sourcing, term sheet negotiation, portfolio construction, governance, exits, and carried interest waterfalls.' },
      { code: '15.416', title: 'Corporate Restructuring', description: 'Distressed debt, Chapter 11 bankruptcy reorganization, turnaround management, debt-for-equity exchanges, and activist investing.' },
      { code: '15.483', title: 'Commodity and Energy Markets', description: 'Energy commodity pricing, futures, options on commodities, carbon markets, geopolitical risk, and the energy transition investment landscape.' },
      { code: '15.487', title: 'Alternative Investments', description: 'Hedge funds, commodities, real estate, infrastructure, private credit, timber, ESG integration, and portfolio construction with alternatives.' },
    ],
  },
  {
    field: 'accounting',
    label: 'Accounting',
    courses: [
      { code: '15.501', title: 'Introduction to Financial Accounting', description: 'Financial statement analysis: income statement, balance sheet, cash flow statement; GAAP principles; accrual accounting; ratio analysis for investment decisions.' },
      { code: '15.511', title: 'Financial Accounting', description: 'Revenue recognition, accruals, inventory methods, depreciation, consolidation, segment reporting, and earnings quality analysis.' },
      { code: '15.515', title: 'Financial and Managerial Accounting', description: 'Cost accounting, activity-based costing, budgeting, variance analysis, transfer pricing, and performance measurement systems.' },
      { code: '15.516', title: 'Advanced Financial Accounting', description: 'Business combinations, purchase accounting, goodwill impairment, fair value measurement, international accounting (IFRS vs. GAAP).' },
    ],
  },
  {
    field: 'strategy',
    label: 'Strategy',
    courses: [
      { code: '15.900', title: 'Strategy and Competitive Dynamics', description: "Competitive advantage sources, Porter's Five Forces, value chain analysis, industry dynamics, strategic positioning, and sustained competitive advantage." },
      { code: '15.903', title: 'Managing Technological Innovation', description: 'Technology strategy, disruptive innovation (Christensen), platform economics, network effects, standards battles, and first-mover advantage.' },
      { code: '15.911', title: 'Corporate Strategy', description: 'Vertical integration, diversification, corporate portfolio management, M&A strategy, competitive moats, and stakeholder management.' },
      { code: '15.912', title: 'Strategy Execution', description: 'Organizational design, change management, leadership in transformation, culture as strategy, balanced scorecard, and OKRs.' },
    ],
  },
  {
    field: 'analytics',
    label: 'Analytics and Data Science',
    courses: [
      { code: '15.071', title: 'The Analytics Edge', description: 'Data-driven decision making: linear regression, logistic regression, CART decision trees, clustering, optimization, text analytics, and recommendation systems.' },
      { code: '15.075', title: 'Statistical Thinking and Data Analysis', description: 'Statistical inference, experimental design, A/B testing, Bayesian methods, simulation, and causal inference for business decisions.' },
      { code: '15.077', title: 'Statistical Learning and Data Mining', description: 'Machine learning for business: supervised/unsupervised learning, random forests, gradient boosting, neural networks, and model evaluation.' },
      { code: '15.099', title: 'Readings in Optimization', description: 'Linear programming, integer programming, stochastic optimization, robust optimization, and supply chain network design.' },
    ],
  },
  {
    field: 'economics',
    label: 'Economics for Management',
    courses: [
      { code: '14.01', title: 'Principles of Microeconomics', description: 'Supply and demand, market equilibrium, elasticity, consumer and producer theory, market structure (competition, oligopoly, monopoly), and externalities.' },
      { code: '14.04', title: 'Intermediate Microeconomic Theory', description: 'Advanced consumer theory, general equilibrium, welfare economics, asymmetric information, game theory, and mechanism design.' },
      { code: '14.30', title: 'Introduction to Statistical Methods in Economics', description: 'Econometrics: OLS regression, instrumental variables, difference-in-differences, regression discontinuity, and causal inference.' },
      { code: '14.462', title: 'Advanced Macroeconomics II', description: 'DSGE models, business cycle theory, monetary policy, fiscal multipliers, and open economy macroeconomics relevant to asset allocation.' },
    ],
  },
  {
    field: 'operations',
    label: 'Operations Management',
    courses: [
      { code: '15.760', title: 'Introduction to Operations Management', description: 'Process analysis, capacity planning, inventory management (EOQ, safety stock), supply chain design, and quality management.' },
      { code: '15.762', title: 'Supply Chain Management', description: 'Demand planning, inventory optimization, supplier relationship management, logistics, global supply chains, and disruption risk.' },
      { code: '15.764', title: 'Theory of Operations Management', description: 'Queueing theory, newsvendor model, revenue management, dynamic pricing, and stochastic inventory control.' },
    ],
  },
  {
    field: 'fintech',
    label: 'FinTech and Financial Innovation',
    courses: [
      { code: '15.468', title: 'FinTech: Shaping the Financial World', description: 'Digital payments, blockchain/DLT, cryptocurrency markets, robo-advisors, open banking, AI in finance, and the regulatory landscape.' },
      { code: '15.S08', title: 'FinTech: Law, Regulation, and Policy', description: 'Regulatory frameworks for digital assets, algorithmic trading regulations, ASIC/SEC enforcement, KYC/AML, and compliance architecture.' },
      { code: '15.481', title: 'Market Microstructure', description: 'Order book dynamics, high-frequency trading, market impact, transaction costs, dark pools, and algorithmic execution strategies.' },
    ],
  },
]

/** Flat catalogue of all Sloan courses for the /api/brain/sloan route. */
export function sloanCourseCatalog(): Array<{ field: string; fieldLabel: string; code: string; title: string; description: string }> {
  return SLOAN_CATALOG.flatMap(({ field, label, courses }) =>
    courses.map((c) => ({ field, fieldLabel: label, code: c.code, title: c.title, description: c.description })),
  )
}

/** Project MIT Sloan Management courses into HellGraph. Idempotent. */
export function projectSloanBrain(): { fields: number; courses: number } {
  const g = getHellGraph()
  if (g.nodesByLabel('SloanCourse').length > 0) return { fields: 0, courses: 0 }
  const now = new Date().toISOString()
  let fields = 0, courses = 0
  for (const { field, label, courses: fieldCourses } of SLOAN_CATALOG) {
    const fieldId = `urn:noetica:sloan:field:${field}`
    try {
      g.addNode(fieldId, ['SloanField'], {
        name: label, surface: label, field,
        source: 'mit-sloan', created_at: now,
      })
      fields++
    } catch { continue }
    for (const c of fieldCourses) {
      const cid = `urn:noetica:sloan:course:${c.code.replace(/\./g, '-')}`
      try {
        g.addNode(cid, ['SloanCourse'], {
          name: c.title, surface: c.title, code: c.code, field,
          description: c.description, source: 'mit-sloan', created_at: now,
        })
        courses++
      } catch { continue }
      try { g.addEdge('HAS_COURSE', fieldId, cid, { kind: 'sloan' }) } catch { /* */ }
    }
  }
  return { fields, courses }
}
