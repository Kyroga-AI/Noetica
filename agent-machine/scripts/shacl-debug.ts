import { getGraph } from '../lib/graph.js'
import { validateGraph } from '@socioprophet/hellgraph'
import { CANONICAL_SHAPES } from '../lib/canonical-shapes.js'
const r = validateGraph(getGraph(), CANONICAL_SHAPES)
console.log('conforms:', r.conforms, 'violations:', r.violations.length)
const by = new Map<string, number>()
for (const v of r.violations) { const k = `${v.constraint} :: ${v.message}`; by.set(k, (by.get(k) ?? 0) + 1) }
for (const [k, n] of [...by.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`  ${n}×  ${k}`)
console.log('sample focusNodes:', r.violations.slice(0, 6).map(v => v.focusNode))
