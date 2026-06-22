/**
 * slash-commands.ts — blekko-style `/topic` scoping in the chat surface (the slash-topics idea, made usable
 * from chat). Typing `/security latest auth changes` scopes the turn to the /security topic; a bare `/finance`
 * sets a persistent scope; `/all` or `/clear` resets it. Pure + client-safe so it runs in the dialogue layer.
 */
export interface SlashScope { topic: string; query: string; clear: boolean }

// Slash words that are app commands, NOT topic scopes — don't hijack them.
const RESERVED = new Set(['help', 'clear', 'new', 'settings', 'model', 'reset', 'cancel', 'stop', 'me', 'shrug', 'nick', 'roll', 'flip', '8ball'])

const SHRUG = '¯\\_(ツ)_/¯'
const EIGHTBALL = ['It is certain.', 'Without a doubt.', 'Most likely.', 'Ask again later.', 'Cannot predict now.', 'Don\'t count on it.', 'My sources say no.', 'Outlook not so good.']

export interface IrcResult { reply: string; setName?: string }

/** IRC classics in the chat surface: /me, /shrug, /nick, /roll, /flip, /8ball. Returns null if not an IRC cmd. */
export function parseIrcCommand(input: string, userName?: string, rng: () => number = Math.random): IrcResult | null {
  const m = input.trim().match(/^\/(\w+)(?:\s+([\s\S]*))?$/)
  if (!m) return null
  const cmd = m[1]!.toLowerCase(), arg = (m[2] ?? '').trim()
  const who = userName?.trim() || 'you'
  switch (cmd) {
    case 'me': return arg ? { reply: `_${who} ${arg}_` } : null
    case 'shrug': return { reply: arg ? `${arg} ${SHRUG}` : SHRUG }
    case 'nick': return arg ? { reply: `_${who} is now known as ${arg}_`, setName: arg } : null
    case 'roll': { const sides = Math.min(1000, Math.max(2, Math.floor(Number(arg.replace(/^d/i, '')) || 6))); return { reply: `_${who} rolls a d${sides}:_ **${1 + Math.floor(rng() * sides)}**` } }
    case 'flip': return { reply: `_${who} flips a coin:_ **${rng() < 0.5 ? 'heads' : 'tails'}**` }
    case '8ball': return { reply: arg ? `🎱 ${EIGHTBALL[Math.min(EIGHTBALL.length - 1, Math.floor(rng() * EIGHTBALL.length))]}` : '🎱 Ask a question after /8ball.' }
    default: return null
  }
}
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
