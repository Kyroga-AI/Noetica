/**
 * constrained-decode.ts — schema-constrained tool-call validation (XGrammar/structured-output role). An
 * injected instruction can't make the model emit an arbitrary payload if tool-call arguments are forced into
 * an allow-listed schema (enums, types). Validate + coerce the model's proposed call against the contract.
 */
export interface ArgSpec { type: 'string' | 'number' | 'boolean' | 'enum'; values?: string[]; required?: boolean }
export interface ToolSchema { name: string; args: Record<string, ArgSpec> }

export function validateToolCall(call: { name: string; args: Record<string, unknown> }, schemas: ToolSchema[]): { valid: boolean; errors: string[]; coerced: Record<string, unknown> } {
  const schema = schemas.find((s) => s.name === call.name)
  const errors: string[] = []
  const coerced: Record<string, unknown> = {}
  if (!schema) return { valid: false, errors: [`unknown tool '${call.name}'`], coerced }
  for (const [k, spec] of Object.entries(schema.args)) {
    const v = call.args[k]
    if (v == null) { if (spec.required) errors.push(`missing required arg '${k}'`); continue }
    switch (spec.type) {
      case 'number': { const n = Number(v); if (Number.isNaN(n)) errors.push(`'${k}' not a number`); else coerced[k] = n; break }
      case 'boolean': coerced[k] = v === true || v === 'true'; break
      case 'enum': if (!spec.values?.includes(String(v))) errors.push(`'${k}'='${String(v)}' not in {${spec.values?.join(', ')}}`); else coerced[k] = String(v); break
      default: coerced[k] = String(v)
    }
  }
  for (const k of Object.keys(call.args)) if (!(k in schema.args)) errors.push(`unexpected arg '${k}'`)
  return { valid: errors.length === 0, errors, coerced }
}
