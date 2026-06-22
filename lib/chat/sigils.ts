/**
 * sigils.ts — multi-sigil command grammar for the chat surface (VS Code-style scope-by-leading-char):
 *   /  → command palette (command-registry.ts)
 *   @  → entity / node reference (address a graph entity — "load a subject" like Bloomberg)
 *   .  → terse alias for / (dot-commands, for terminal muscle memory): `.help` == `/help`
 *   #  → topic/tag scope (alias for the blekko /topic scope)
 * Pure + client-safe; the dialogue layer routes on the parsed sigil.
 */
export type Sigil = '/' | '@' | '.' | '#'

export interface SigilParse { sigil: Sigil; word: string; args: string; raw: string }

export function parseSigil(input: string): SigilParse | null {
  const raw = input.trim()
  const m = raw.match(/^([/@.#])([\w][\w-]*)?(?:\s+([\s\S]*))?$/)
  if (!m) return null
  return { sigil: m[1] as Sigil, word: (m[2] ?? '').toLowerCase(), args: (m[3] ?? '').trim(), raw }
}

/** `.cmd` → `/cmd` so the same command registry serves both prefixes. */
export function dotToSlash(input: string): string {
  return input.startsWith('.') ? '/' + input.slice(1) : input
}

/** `@entity` → the referenced entity (rest is an optional follow-up). */
export function parseEntityRef(input: string): { entity: string; rest: string } | null {
  const p = parseSigil(input)
  if (!p || p.sigil !== '@' || !p.word) return null
  return { entity: p.word, rest: p.args }
}

/** `#tag` → topic scope token (mirrors /topic). */
export function parseTagScope(input: string): { topic: string; query: string } | null {
  const p = parseSigil(input)
  if (!p || p.sigil !== '#' || !p.word) return null
  return { topic: p.word, query: p.args }
}
