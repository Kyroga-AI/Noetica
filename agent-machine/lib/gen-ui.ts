/**
 * gen-ui.ts — generative-UI spec validation. Instead of a wall of prose, the agent can emit a typed,
 * interactive component (card/table/chart/list/metric/form). To keep this safe (no arbitrary codegen), the
 * model may only emit specs from a WHITELISTED catalog with validated prop shapes — the discipline that
 * separates generative UI from an injection vector.
 */
export const ALLOWED_COMPONENTS = ['card', 'table', 'chart', 'list', 'metric', 'form'] as const
export type AllowedComponent = typeof ALLOWED_COMPONENTS[number]

export interface UISpec { component: string; props: Record<string, unknown> }

const REQUIRED_PROPS: Record<AllowedComponent, string[]> = {
  card: ['title'], table: ['columns', 'rows'], chart: ['kind', 'data'], list: ['items'], metric: ['label', 'value'], form: ['fields'],
}

export function validateUISpec(spec: UISpec): { valid: boolean; errors: string[] } {
  const errors: string[] = []
  if (!ALLOWED_COMPONENTS.includes(spec.component as AllowedComponent)) errors.push(`component '${spec.component}' not in whitelist`)
  else for (const r of REQUIRED_PROPS[spec.component as AllowedComponent]) if (!(r in (spec.props ?? {}))) errors.push(`missing prop '${r}'`)
  return { valid: errors.length === 0, errors }
}

/** Drop any disallowed components from an emitted spec list, keeping only valid ones. */
export function sanitizeUISpecs(specs: UISpec[]): UISpec[] {
  return specs.filter((s) => validateUISpec(s).valid)
}
