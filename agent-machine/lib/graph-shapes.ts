/**
 * graph-shapes.ts — SHACL-lite shape validation: REJECT bad data (our engine only ever adds). Validates
 * graph nodes against per-kind shapes (required properties, max cardinality, enum membership) so structural
 * violations surface instead of silently entering the graph. Shapes derive naturally from GAIA node kinds.
 */
export interface Shape {
  kind: string
  required?: string[]                       // properties that must be present + non-empty
  maxCount?: Record<string, number>         // property → max allowed values (arrays)
  enumOf?: Record<string, string[]>         // property → allowed value set
}

export interface ShapeViolation { node: string; kind: string; constraint: 'required' | 'maxCount' | 'enum'; property: string; detail: string }

export function validateNode(node: { id: string; kind: string; props: Record<string, unknown> }, shape: Shape): ShapeViolation[] {
  const out: ShapeViolation[] = []
  for (const r of shape.required ?? []) {
    const v = node.props[r]
    if (v == null || v === '' || (Array.isArray(v) && v.length === 0)) out.push({ node: node.id, kind: node.kind, constraint: 'required', property: r, detail: `missing required '${r}'` })
  }
  for (const [p, max] of Object.entries(shape.maxCount ?? {})) {
    const v = node.props[p]
    const count = Array.isArray(v) ? v.length : v == null ? 0 : 1
    if (count > max) out.push({ node: node.id, kind: node.kind, constraint: 'maxCount', property: p, detail: `${p}: ${count} > max ${max}` })
  }
  for (const [p, allowed] of Object.entries(shape.enumOf ?? {})) {
    const v = node.props[p]
    if (v != null && !allowed.includes(String(v))) out.push({ node: node.id, kind: node.kind, constraint: 'enum', property: p, detail: `${p}='${String(v)}' not in {${allowed.join(', ')}}` })
  }
  return out
}

export function validateAll(nodes: Array<{ id: string; kind: string; props: Record<string, unknown> }>, shapes: Shape[]): ShapeViolation[] {
  const byKind = new Map(shapes.map((s) => [s.kind, s]))
  return nodes.flatMap((n) => { const s = byKind.get(n.kind); return s ? validateNode(n, s) : [] })
}
