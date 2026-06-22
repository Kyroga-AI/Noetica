/**
 * tool-validate — the verifier applied to TOOL turns (Phase 1b). Local 7–14B models are the
 * weakest at structured output: the #1 agentic blocker is malformed tool-arg JSON and missing
 * required args, today swallowed by `catch { return {} }` so a broken call runs silently. Two
 * pure pieces:
 *   • repairToolArgs — recovers malformations JSON5 doesn't: truncated objects (unbalanced
 *     braces/brackets/quotes), Python literals (True/False/None), and trailing prose.
 *   • validateToolCall — checks a parsed call against its schema (required present + primitive
 *     types) and returns a RE-PROMPT hint, so the loop can ask the model to fix the call instead
 *     of executing a broken one. This is the critic gate, for tools.
 */

import JSON5 from 'json5'

export interface ToolParamSchema {
  required?: string[]
  properties?: Record<string, { type?: string }>
}

export interface RepairResult {
  value: Record<string, unknown> | null
  repaired: boolean // true when anything beyond a clean JSON.parse was needed
  method: string // 'direct' | 'json5' | 'extract' | 'balanced' | 'failed'
}

function asObj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

/** Append the closers a truncated emission is missing (dangling string, then open brackets). */
function balance(s: string): string {
  const stack: string[] = []
  let quote: string | null = null
  let esc = false
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!
    if (quote) {
      if (esc) esc = false
      else if (ch === '\\') esc = true
      else if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'") quote = ch
    else if (ch === '{') stack.push('}')
    else if (ch === '[') stack.push(']')
    else if (ch === '}' || ch === ']') { if (stack[stack.length - 1] === ch) stack.pop() }
  }
  let out = s
  if (quote) out += quote
  while (stack.length) out += stack.pop()
  return out
}

export function repairToolArgs(raw: string): RepairResult {
  const tryParse = (s: string, method: string): RepairResult | null => {
    try { const o = asObj(JSON.parse(s)); if (o) return { value: o, repaired: method !== 'direct', method } } catch { /* next */ }
    try { const o = asObj(JSON5.parse(s)); if (o) return { value: o, repaired: true, method: method === 'direct' ? 'json5' : `${method}+json5` } } catch { /* next */ }
    return null
  }

  const direct = tryParse(raw.trim(), 'direct')
  if (direct) return direct

  // Strip code fences + leading prose; start at the first '{'.
  let s = raw.replace(/```(?:json|tool_call)?/gi, '').trim()
  const open = s.indexOf('{')
  if (open > 0) s = s.slice(open)
  // Python literals → JSON (local models leak these when echoing python-ish args).
  s = s.replace(/\bTrue\b/g, 'true').replace(/\bFalse\b/g, 'false').replace(/\bNone\b/g, 'null')
  const extracted = tryParse(s, 'extract')
  if (extracted) return extracted

  // Last resort: close a truncated object/array/string.
  const balanced = tryParse(balance(s), 'balanced')
  if (balanced) return balanced

  return { value: null, repaired: false, method: 'failed' }
}

export interface ToolVerdict {
  ok: boolean
  missing: string[]
  typeErrors: string[]
  repromptHint: string | null // feed back to the model to fix the call; null when ok
}

function jsonType(v: unknown): string {
  if (v === null) return 'null'
  if (Array.isArray(v)) return 'array'
  return typeof v
}
const typeMatches = (actual: string, expected: string): boolean =>
  expected === 'integer' ? actual === 'number' : actual === expected

/** Gate a parsed tool call against its schema: required args present, primitive types correct. */
export function validateToolCall(name: string, args: Record<string, unknown>, schema: ToolParamSchema): ToolVerdict {
  const missing = (schema.required ?? []).filter((k) => !(k in args) || args[k] === undefined || args[k] === null || args[k] === '')
  const typeErrors: string[] = []
  for (const [k, spec] of Object.entries(schema.properties ?? {})) {
    if (k in args && args[k] != null && spec.type) {
      const actual = jsonType(args[k])
      if (!typeMatches(actual, spec.type)) typeErrors.push(`${k}: expected ${spec.type}, got ${actual}`)
    }
  }
  const ok = missing.length === 0 && typeErrors.length === 0
  const parts = [
    missing.length ? `missing required argument${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}` : '',
    typeErrors.length ? `type mismatch — ${typeErrors.join('; ')}` : '',
  ].filter(Boolean)
  return {
    ok,
    missing,
    typeErrors,
    repromptHint: ok ? null : `Your call to "${name}" is invalid (${parts.join('; ')}). Re-emit the tool call as JSON with all required arguments and correct types.`,
  }
}
