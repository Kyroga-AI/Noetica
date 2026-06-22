/**
 * Inline tool-call parsing for local (Ollama) models.
 *
 * Local models frequently emit tool calls as plain TEXT instead of via the
 * structured tool_calls API — they print `<tool_call>{...}</tool_call>` (the
 * format our system prompt requests), a ```json fence, or one-or-more bare
 * `{"name":...}` objects. Without recovering these, the agentic loop never sees
 * the call and just shows the raw JSON to the user (the "it dumped JSON and
 * stopped" bug). This module turns those text emissions back into tool calls.
 *
 * Local models also emit INVALID JSON in those calls — single-quoted string values,
 * unquoted keys, trailing commas — so parsing falls back to JSON5. Still pure and
 * deterministically testable against the real malformed outputs we observe.
 */

import JSON5 from 'json5'
import { repairToolArgs } from './tool-validate.js'

export interface InlineToolCall {
  id: string
  name: string
  input: Record<string, unknown>
}

export function parseInlineToolCalls(
  text: string,
  validNames: Set<string>,
): { calls: InlineToolCall[]; cleaned: string } {
  const calls: InlineToolCall[] = []
  let cleaned = text

  const tryAdd = (raw: string): boolean => {
    const trimmed = raw.trim()
    let obj: unknown
    try { obj = JSON.parse(trimmed) }
    catch {
      // Tolerate the invalid JSON local models emit: single-quoted string values
      // (e.g. "code": 'def f(): ...'), unquoted keys, trailing commas.
      try { obj = JSON5.parse(trimmed) }
      catch {
        // Deeper recovery (truncated objects, Python True/False/None, trailing prose) —
        // strictly additive: only runs once JSON + JSON5 have both already failed.
        obj = repairToolArgs(trimmed).value
        if (!obj) return false
      }
    }
    if (!obj || typeof obj !== 'object') return false
    const o = obj as Record<string, unknown>
    const name =
      typeof o['name'] === 'string' ? (o['name'] as string)
      : typeof o['tool'] === 'string' ? (o['tool'] as string)
      : ''
    if (!name || !validNames.has(name)) return false
    const args = (o['arguments'] ?? o['parameters'] ?? o['input'] ?? {}) as unknown
    calls.push({
      id: `tc-inline-${calls.length}`,
      name,
      input: args && typeof args === 'object' ? (args as Record<string, unknown>) : {},
    })
    return true
  }

  // 1) <tool_call>{...}</tool_call> — the format our system prompt requests
  cleaned = cleaned.replace(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/gi, (m, body: string) =>
    tryAdd(body) ? '' : m,
  )

  // 2) fenced ```json {...}``` whose body is a tool-call object
  cleaned = cleaned.replace(/```(?:json|tool_call)?\s*([\s\S]*?)```/gi, (m, body: string) =>
    tryAdd(body) ? '' : m,
  )

  // 3) bare balanced {...} objects — one or many, possibly pretty-printed. Walks
  //    the string tracking brace depth (ignoring braces inside strings) so it can
  //    pull out multiple back-to-back objects from a multi-step emission.
  const spans: Array<[number, number]> = []
  let depth = 0, start = -1, quote: string | null = null, esc = false
  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i]!
    if (quote) {
      // Track single- AND double-quoted strings so braces inside a single-quoted
      // value (e.g. python code) don't throw off the depth count.
      if (esc) esc = false
      else if (ch === '\\') esc = true
      else if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'") quote = ch
    else if (ch === '{') { if (depth === 0) start = i; depth++ }
    else if (ch === '}' && depth > 0 && --depth === 0 && start >= 0) { spans.push([start, i + 1]); start = -1 }
  }
  if (spans.length) {
    let rebuilt = ''
    let last = 0
    for (const [s, e] of spans) {
      if (tryAdd(cleaned.slice(s, e))) { rebuilt += cleaned.slice(last, s); last = e }
    }
    rebuilt += cleaned.slice(last)
    cleaned = rebuilt
  }

  // Strip any orphan tool-call tags the model left dangling (e.g. a closing
  // </tool_call> with no opening) so they never leak into the visible response.
  cleaned = cleaned.replace(/<\/?tool_call>/gi, '')

  return { calls, cleaned: cleaned.trim() }
}
