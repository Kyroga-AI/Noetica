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
 * It is intentionally pure + dependency-free so it can be unit-tested against the
 * real-world malformed outputs we observe, deterministically (no model needed).
 */

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
    let obj: unknown
    try { obj = JSON.parse(raw.trim()) } catch { return false }
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
  let depth = 0, start = -1, inStr = false, esc = false
  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i]!
    if (inStr) {
      if (esc) esc = false
      else if (ch === '\\') esc = true
      else if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') inStr = true
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

  return { calls, cleaned: cleaned.trim() }
}
