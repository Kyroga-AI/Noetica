/**
 * slash-commands.ts — blekko-style `/topic` scoping in the chat surface (the slash-topics idea, made usable
 * from chat). Typing `/security latest auth changes` scopes the turn to the /security topic; a bare `/finance`
 * sets a persistent scope; `/all` or `/clear` resets it. Pure + client-safe so it runs in the dialogue layer.
 */
export interface SlashScope { topic: string; query: string; clear: boolean }

// Slash words that are app commands, NOT topic scopes — don't hijack them.
const RESERVED = new Set(['help', 'clear', 'new', 'settings', 'model', 'reset', 'cancel', 'stop'])
const CLEAR = new Set(['all', 'clear', 'reset', 'none'])

/** Parse a leading `/word [query]`. Returns null if the input isn't a slash command. */
export function parseSlashScope(input: string): SlashScope | null {
  const m = input.trim().match(/^\/([a-z0-9][a-z0-9_-]{0,40})(?:\s+([\s\S]*))?$/i)
  if (!m) return null
  const topic = m[1]!.toLowerCase()
  if (CLEAR.has(topic)) return { topic: '', query: (m[2] ?? '').trim(), clear: true }
  return { topic, query: (m[2] ?? '').trim(), clear: false }
}

/** Whether the input is a topic-scope command (and not a reserved app command). */
export function isTopicCommand(input: string): boolean {
  const p = parseSlashScope(input)
  if (!p) return false
  if (p.clear) return true
  return p.topic.length > 0 && !RESERVED.has(p.topic)
}

/** Apply an active scope to a follow-up query (so subsequent turns stay scoped until cleared). */
export function withScope(query: string, activeTopic: string | null): { topic: string | null; query: string } {
  const parsed = parseSlashScope(query)
  if (parsed?.clear) return { topic: null, query: parsed.query }
  if (parsed && isTopicCommand(query)) return { topic: parsed.topic, query: parsed.query }
  return { topic: activeTopic, query }
}
