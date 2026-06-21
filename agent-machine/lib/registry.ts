/**
 * registry — the catalogue keystone.
 *
 * Connectors, code/scaffold templates, chart specs, and reusable assets are ALL the same
 * object: a RegistryEntry with a typed contract, queryable by intent. "user wants a revenue
 * chart" → finance/timeseries → the line-chart template, populated with data. Don't start
 * from scratch — compose from the catalogue. The seed catalogue is built-in; entries are also
 * persisted to HellGraph so the agent can register new ones and they survive restarts.
 */
import { getGraph } from './graph.js'

export type RegistryKind = 'chart' | 'template' | 'connector' | 'asset' | 'crawl'

export interface RegistryEntry {
  id: string
  kind: RegistryKind
  title: string
  description: string
  domains: string[]   // ['finance','ops','geo','general'…]
  intents: string[]   // ['timeseries','comparison','distribution'…] — natural phrasings
  params: string[]    // slots the caller fills, e.g. ['data','x','y']
  spec?: unknown      // Vega-Lite spec | scaffold descriptor | connector handler ref
  source?: string
}

const VL = 'https://vega.github.io/schema/vega-lite/v5.json'

// ── Chart catalogue: Vega-Lite specs by domain/intent. {{slots}} are filled with field names. ──
const CHART_ENTRIES: RegistryEntry[] = [
  { id: 'chart.timeseries.line', kind: 'chart', title: 'Time series (line)',
    description: 'A value over time — trends, revenue, metrics across dates.',
    domains: ['finance', 'ops', 'analytics', 'general'], intents: ['timeseries', 'trend', 'over time', 'growth', 'history'],
    params: ['data', 'x', 'y'],
    spec: { $schema: VL, mark: { type: 'line', point: true }, encoding: { x: { field: '{{x}}', type: 'temporal' }, y: { field: '{{y}}', type: 'quantitative' } } } },
  { id: 'chart.area.trend', kind: 'chart', title: 'Area (cumulative trend)',
    description: 'A filled trend over time — volume, cumulative totals.',
    domains: ['finance', 'ops', 'analytics'], intents: ['cumulative', 'volume', 'stacked over time', 'area'],
    params: ['data', 'x', 'y'],
    spec: { $schema: VL, mark: 'area', encoding: { x: { field: '{{x}}', type: 'temporal' }, y: { field: '{{y}}', type: 'quantitative' } } } },
  { id: 'chart.bar.comparison', kind: 'chart', title: 'Bar (comparison)',
    description: 'Compare a quantity across categories — ranking, by-group totals.',
    domains: ['analytics', 'ops', 'general'], intents: ['comparison', 'ranking', 'by category', 'compare', 'top'],
    params: ['data', 'x', 'y'],
    spec: { $schema: VL, mark: 'bar', encoding: { x: { field: '{{x}}', type: 'nominal', sort: '-y' }, y: { field: '{{y}}', type: 'quantitative' } } } },
  { id: 'chart.hist.distribution', kind: 'chart', title: 'Histogram (distribution)',
    description: 'The distribution of one numeric variable.',
    domains: ['analytics', 'science', 'general'], intents: ['distribution', 'histogram', 'spread', 'frequency'],
    params: ['data', 'x'],
    spec: { $schema: VL, mark: 'bar', encoding: { x: { field: '{{x}}', type: 'quantitative', bin: true }, y: { aggregate: 'count' } } } },
  { id: 'chart.box.distribution', kind: 'chart', title: 'Box plot (distribution by group)',
    description: 'Compare distributions across groups — median, quartiles, outliers.',
    domains: ['analytics', 'science'], intents: ['box plot', 'quartiles', 'distribution by group', 'outliers'],
    params: ['data', 'x', 'y'],
    spec: { $schema: VL, mark: 'boxplot', encoding: { x: { field: '{{x}}', type: 'nominal' }, y: { field: '{{y}}', type: 'quantitative' } } } },
  { id: 'chart.scatter.correlation', kind: 'chart', title: 'Scatter (correlation)',
    description: 'Relationship between two numeric variables.',
    domains: ['analytics', 'science', 'finance'], intents: ['correlation', 'scatter', 'relationship', 'vs'],
    params: ['data', 'x', 'y'],
    spec: { $schema: VL, mark: 'point', encoding: { x: { field: '{{x}}', type: 'quantitative' }, y: { field: '{{y}}', type: 'quantitative' } } } },
  { id: 'chart.pie.proportion', kind: 'chart', title: 'Pie / donut (proportion)',
    description: 'Parts of a whole — share, composition.',
    domains: ['analytics', 'general'], intents: ['proportion', 'share', 'composition', 'percentage', 'pie', 'donut'],
    params: ['data', 'category', 'value'],
    spec: { $schema: VL, mark: { type: 'arc', innerRadius: 50 }, encoding: { theta: { field: '{{value}}', type: 'quantitative' }, color: { field: '{{category}}', type: 'nominal' } } } },
  { id: 'chart.heatmap.matrix', kind: 'chart', title: 'Heatmap (matrix)',
    description: 'Intensity across two categorical dimensions.',
    domains: ['analytics', 'ops'], intents: ['heatmap', 'matrix', 'intensity', 'cross-tab'],
    params: ['data', 'x', 'y', 'value'],
    spec: { $schema: VL, mark: 'rect', encoding: { x: { field: '{{x}}', type: 'nominal' }, y: { field: '{{y}}', type: 'nominal' }, color: { field: '{{value}}', type: 'quantitative' } } } },
  { id: 'chart.candlestick.ohlc', kind: 'chart', title: 'Candlestick (OHLC)',
    description: 'Financial price action — open/high/low/close over time.',
    domains: ['finance', 'trading'], intents: ['candlestick', 'ohlc', 'price', 'stock', 'trading'],
    params: ['data', 'date', 'open', 'high', 'low', 'close'],
    spec: { $schema: VL, encoding: { x: { field: '{{date}}', type: 'temporal' } }, layer: [{ mark: 'rule', encoding: { y: { field: '{{low}}', type: 'quantitative' }, y2: { field: '{{high}}' } } }, { mark: 'bar', encoding: { y: { field: '{{open}}', type: 'quantitative' }, y2: { field: '{{close}}' } } }] } },
  { id: 'chart.choropleth.geo', kind: 'chart', title: 'Choropleth (geo)',
    description: 'A metric shaded across a map — by region/zip/country. Renders on the Maps surface.',
    domains: ['geo', 'analytics'], intents: ['map', 'geographic', 'by region', 'by zip', 'choropleth', 'by state'],
    params: ['data', 'region', 'value'],
    spec: { $schema: VL, mark: 'geoshape', encoding: { color: { field: '{{value}}', type: 'quantitative' } }, note: 'renders via the GAIA Maps surface' } },
]

// ── Templates: reusable scaffolds (the Vite build flow is the first one). ──
const TEMPLATE_ENTRIES: RegistryEntry[] = [
  { id: 'template.scaffold.web', kind: 'template', title: 'Web app (Vite)',
    description: 'Scaffold + install + run a Vue/React/Svelte/Solid/Vanilla app via the deterministic build flow.',
    domains: ['web', 'frontend'], intents: ['build app', 'build ui', 'website', 'dashboard', 'spa', 'web app'],
    params: ['framework', 'typescript'],
    spec: { endpoint: '/api/code/scaffold', deterministic: true } },
]

export const SEED_ENTRIES: RegistryEntry[] = [...CHART_ENTRIES, ...TEMPLATE_ENTRIES]

// Runtime entries persisted to the graph (the agent can register new ones).
let _runtime: RegistryEntry[] | null = null
function runtimeEntries(): RegistryEntry[] {
  if (_runtime) return _runtime
  _runtime = []
  try {
    const g = getGraph()
    for (const n of g.allNodes()) {
      if ((n.labels ?? []).includes('RegistryEntry')) {
        const raw = (n.properties as Record<string, unknown>)?.['entry']
        if (typeof raw === 'string') { try { _runtime.push(JSON.parse(raw) as RegistryEntry) } catch { /* skip */ } }
      }
    }
  } catch { /* graph unavailable */ }
  return _runtime
}

function allEntries(): RegistryEntry[] {
  const seen = new Set(SEED_ENTRIES.map((e) => e.id))
  return [...SEED_ENTRIES, ...runtimeEntries().filter((e) => !seen.has(e.id))]
}

/** Query the catalogue by intent — keyword-scored over title/description/intents/domains. */
export function queryRegistry(opts: { kind?: RegistryKind; q?: string; domain?: string; limit?: number }): RegistryEntry[] {
  const q = (opts.q ?? '').toLowerCase().trim()
  const words = q.split(/\s+/).filter((w) => w.length > 2)
  const scored = allEntries()
    .filter((e) => !opts.kind || e.kind === opts.kind)
    .filter((e) => !opts.domain || e.domains.includes(opts.domain))
    .map((e) => {
      const hay = `${e.title} ${e.description} ${e.intents.join(' ')} ${e.domains.join(' ')}`.toLowerCase()
      let score = 0
      for (const w of words) {
        if (e.intents.some((i) => i.includes(w))) score += 2
        else if (hay.includes(w)) score += 1
      }
      return { e, score }
    })
    .filter((x) => !words.length || x.score > 0)
    .sort((a, b) => b.score - a.score)
  return scored.slice(0, opts.limit ?? 8).map((x) => x.e)
}

/** Register a new entry (persisted to the graph so it survives restarts and compounds). */
export function registerEntry(entry: RegistryEntry): void {
  if (!entry.id || !entry.kind) return
  runtimeEntries()
  _runtime = [...(_runtime ?? []).filter((e) => e.id !== entry.id), entry]
  try {
    const g = getGraph()
    g.addNode(`registry:${entry.id}`, ['RegistryEntry'], { entry: JSON.stringify(entry), kind: entry.kind, created_at: new Date().toISOString() })
  } catch { /* best-effort */ }
}
