// Typed action layer (Bet C) — the catalog of typed, parameterized actions the agent can take, with the
// metadata a preview→approve UX and the scope-d gate need. v1 is the typed CONTRACT + catalog: each entry
// maps to an existing built-in tool and declares its action class, reversibility, params, and a
// human-readable preview of exactly what a given call will do. Execution still flows through the gated
// tool path (execute_action / built-in tools) — the registry never opens a new un-gated execution route.
// Next phase: per-action approve/undo UX wired to these previews + reversibility handlers.

export type ActionClass = 'read' | 'write' | 'exec' | 'net' | 'memory'

export interface ActionParam {
  name: string
  type: 'string' | 'number' | 'boolean'
  required: boolean
  description: string
}

export interface ActionDef {
  id: string
  label: string
  description: string
  actionClass: ActionClass
  /** Can the effect be undone (backup kept / inverse exists)? Drives the confirm UX weight. */
  reversible: boolean
  /** The underlying built-in tool this typed action maps to. */
  tool: string
  params: ActionParam[]
  /** Human preview of what a specific call will do — shown before approval. */
  preview: (p: Record<string, unknown>) => string
}

const s = (p: Record<string, unknown>, k: string) => String(p[k] ?? '').trim()

export const ACTION_CATALOG: ActionDef[] = [
  {
    id: 'write_file', label: 'Write file', description: 'Create or overwrite a local file. A backup of any existing file is kept, so it can be undone.',
    actionClass: 'write', reversible: true, tool: 'write_file',
    params: [
      { name: 'path', type: 'string', required: true, description: 'File path (under home or /tmp)' },
      { name: 'content', type: 'string', required: true, description: 'Text content to write' },
    ],
    preview: (p) => `Write ${s(p, 'content').length} chars to ${s(p, 'path') || '(path)'} (existing file backed up).`,
  },
  {
    id: 'append_note', label: 'Append to note', description: 'Append a line to a note or log file. Reversible (removes the appended line).',
    actionClass: 'write', reversible: true, tool: 'write_file',
    params: [
      { name: 'path', type: 'string', required: true, description: 'Note/log file path' },
      { name: 'text', type: 'string', required: true, description: 'Line to append' },
    ],
    preview: (p) => `Append "${s(p, 'text').slice(0, 60)}" to ${s(p, 'path') || '(path)'}.`,
  },
  {
    id: 'run_command', label: 'Run command', description: 'Run a shell command in the sandbox. NOT reversible — review carefully before approving.',
    actionClass: 'exec', reversible: false, tool: 'run_command',
    params: [{ name: 'command', type: 'string', required: true, description: 'Shell command' }],
    preview: (p) => `Run: ${s(p, 'command') || '(command)'} — irreversible; review before approving.`,
  },
  {
    id: 'web_search', label: 'Web search', description: 'Search the web. Read-only; leaves the device only to fetch results.',
    actionClass: 'net', reversible: true, tool: 'web_search',
    params: [{ name: 'query', type: 'string', required: true, description: 'Search query' }],
    preview: (p) => `Search the web for "${s(p, 'query') || '(query)'}".`,
  },
  {
    id: 'remember', label: 'Remember', description: 'Save a durable fact to local memory. Reversible (the memory can be deleted).',
    actionClass: 'memory', reversible: true, tool: 'remember',
    params: [{ name: 'fact', type: 'string', required: true, description: 'The fact to remember' }],
    preview: (p) => `Remember: "${s(p, 'fact').slice(0, 80)}".`,
  },
  {
    id: 'read_file', label: 'Read file', description: 'Read a local file. Read-only, no side effects.',
    actionClass: 'read', reversible: true, tool: 'read_file',
    params: [{ name: 'path', type: 'string', required: true, description: 'File path' }],
    preview: (p) => `Read ${s(p, 'path') || '(path)'}.`,
  },
]

export function getAction(id: string): ActionDef | undefined {
  return ACTION_CATALOG.find((a) => a.id === id)
}

/** Client-safe view of the catalog (drops the preview function; keeps a rendered sample preview). */
export function catalogForClient(): Array<Omit<ActionDef, 'preview'>> {
  return ACTION_CATALOG.map(({ preview: _preview, ...rest }) => rest)
}

/** Render the preview for a specific action + params (used by the approve UX / proposals). */
export function renderPreview(id: string, params: Record<string, unknown>): string | null {
  const a = getAction(id)
  return a ? a.preview(params) : null
}
