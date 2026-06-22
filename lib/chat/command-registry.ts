/**
 * command-registry.ts — the slash-command palette for the chat surface: a power-user command line (Bloomberg
 * mnemonics + Raycast scopes + Slack hints) so the user can do anything the agent can — navigate, search the
 * catalog/data, look up models, run capabilities, query the graph, drive MCP tools, read memory.
 *
 * Declarative + extensible: add a row here and it's discoverable via /help and routable from chat.
 */
export type CmdAction =
  | { kind: 'navigate'; surface: string }
  | { kind: 'help' }
  | { kind: 'topic' }
  | { kind: 'irc' }
  | { kind: 'soon'; note: string }

export interface SlashCmd {
  name: string
  aliases?: string[]
  category: 'Navigate' | 'Data' | 'Graph' | 'Model' | 'Tools' | 'Memory' | 'Topic' | 'Fun' | 'Help'
  hint: string          // inline arg hint (Slack/Bloomberg)
  desc: string
  action: CmdAction
}

export const COMMANDS: SlashCmd[] = [
  { name: 'help', aliases: ['?', 'commands'], category: 'Help', hint: '/help', desc: 'List every command', action: { kind: 'help' } },
  // Navigate (Bloomberg <GO>)
  { name: 'go', category: 'Navigate', hint: '/go <view>', desc: 'Jump to any surface', action: { kind: 'navigate', surface: '' } },
  { name: 'studio', category: 'Navigate', hint: '/studio', desc: 'Prompt workbench + model compare', action: { kind: 'navigate', surface: 'studio' } },
  { name: 'rag', category: 'Data', hint: '/rag <query>', desc: 'RAG retrieval inspector (chunks + scores)', action: { kind: 'navigate', surface: 'rag' } },
  { name: 'lab', aliases: ['cap', 'run'], category: 'Tools', hint: '/lab', desc: 'Capabilities lab — run any /api/cap', action: { kind: 'navigate', surface: 'lab' } },
  { name: 'graph', aliases: ['g'], category: 'Graph', hint: '/graph <entity>', desc: 'Graph + GDS analytics', action: { kind: 'navigate', surface: 'operate' } },
  { name: 'evaluate', aliases: ['eval'], category: 'Tools', hint: '/eval', desc: 'Benchmarks + outcome traces', action: { kind: 'navigate', surface: 'evaluate' } },
  { name: 'code', category: 'Navigate', hint: '/code', desc: 'Source + repositories', action: { kind: 'navigate', surface: 'code' } },
  { name: 'govern', category: 'Navigate', hint: '/govern', desc: 'Policy trace + evidence', action: { kind: 'navigate', surface: 'govern' } },
  // Data / catalog / model / memory / tools
  { name: 'search', aliases: ['find'], category: 'Data', hint: '/search <query>', desc: 'Search catalog + documents', action: { kind: 'navigate', surface: 'rag' } },
  { name: 'model', aliases: ['models'], category: 'Model', hint: '/model [name]', desc: 'Model lookup + compare', action: { kind: 'navigate', surface: 'studio' } },
  { name: 'memory', aliases: ['remember'], category: 'Memory', hint: '/memory <query>', desc: 'Read/append agent memory', action: { kind: 'navigate', surface: 'govern' } },
  { name: 'mcp', aliases: ['tool', 'tools'], category: 'Tools', hint: '/mcp <tool>', desc: 'MCP tools — invoke directly', action: { kind: 'soon', note: 'MCP tool palette' } },
  { name: 'data', category: 'Data', hint: '/data <source>', desc: 'Preview a dataset/connector', action: { kind: 'soon', note: 'inline dataset preview' } },
  // Topic + Fun (already live)
  { name: 'topic', category: 'Topic', hint: '/topic <query>', desc: 'Blekko-style topic scope', action: { kind: 'topic' } },
  { name: 'me', aliases: ['shrug', 'nick', 'roll', 'flip', '8ball'], category: 'Fun', hint: '/me <action>', desc: 'IRC classics', action: { kind: 'irc' } },
]

const INDEX = (() => {
  const m = new Map<string, SlashCmd>()
  for (const c of COMMANDS) { m.set(c.name, c); for (const a of c.aliases ?? []) m.set(a, c) }
  return m
})()

/** Resolve `/<word> [args]` to a registered command (exact, then prefix). Null if not registered. */
export function matchCommand(input: string): { cmd: SlashCmd; args: string } | null {
  const m = input.trim().match(/^\/(\w+|\?)(?:\s+([\s\S]*))?$/)
  if (!m) return null
  const word = m[1]!.toLowerCase(), args = (m[2] ?? '').trim()
  const exact = INDEX.get(word)
  if (exact) return { cmd: exact, args }
  // Prefix routing only when UNAMBIGUOUS (exactly one candidate) + ≥2 chars — else a stray `/s` or a pasted
  // path like `/etc/hosts` would hijack to whatever's first in COMMANDS.
  if (word.length < 2) return null
  const pref = COMMANDS.filter((c) => c.name.startsWith(word) || (c.aliases ?? []).some((a) => a.startsWith(word)))
  return pref.length === 1 ? { cmd: pref[0]!, args } : null
}

/** Grouped, browsable command list (Bloomberg-style discovery). */
export function formatHelp(): string {
  const groups = new Map<string, SlashCmd[]>()
  for (const c of COMMANDS) (groups.get(c.category) ?? groups.set(c.category, []).get(c.category)!).push(c)
  const lines = ['**Slash commands** — type `/` then:']
  for (const [cat, cmds] of groups) {
    lines.push(`\n**${cat}**`)
    for (const c of cmds) lines.push(`  \`${c.hint}\` — ${c.desc}`)
  }
  return lines.join('\n')
}

export const KNOWN_PREFIXES = [...INDEX.keys()]
