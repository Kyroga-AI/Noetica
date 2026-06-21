/**
 * session-graph — use the platform we already have (HellGraph atoms + STI attention) to
 * give the agent long-horizon coherence and repo-scale context that a 7B can't hold in
 * its window. The gap the audit found: goals are frozen at loop entry, turns are JSONL
 * (not atoms), and files-touched are tracked nowhere. This builds the missing graph:
 *
 *   Session ──HAS_TURN──▶ Turn ──TOUCHED──▶ File ──HAS_SYMBOL──▶ Symbol
 *      │                    │
 *      └──HAS_GOAL──▶ Goal ◀──PROGRESSES──┘
 *
 * Every request we (a) record the turn + the files it touched + their internal ontology
 * as atoms, (b) write back goal progress, and (c) re-derive a compact session brief from
 * the graph so the model always sees the objective, recent turns, and what files/symbols
 * are in play — sourced from atoms, not the (small) context window.
 *
 * The graph store is injected (the real getHellGraph() store, or a fake in tests).
 */

import * as fs from 'node:fs'

// ── Minimal store interface (the real HellGraph store satisfies this) ──────────
export interface GraphNodeLike { id: string; labels: string[]; properties: Record<string, unknown> }
export interface GraphStore {
  getNode(id: string): GraphNodeLike | null
  addNode(id: string, labels: string[], properties: Record<string, unknown>): GraphNodeLike
  addEdge(label: string, fromId: string, toId: string, properties?: Record<string, unknown>): unknown
  out(id: string, edgeLabel?: string): GraphNodeLike[]
}

const SESSION = (id: string) => `urn:noetica:session:${id}`
const TURN = (sid: string, n: number) => `urn:noetica:turn:${sid}:${n}`
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9._/-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120)
const FILE = (absPath: string) => `urn:noetica:file:${slug(absPath)}`
const SYMBOL = (absPath: string, name: string) => `urn:noetica:sym:${slug(absPath)}:${slug(name)}`

export type FileOp = 'read' | 'edit' | 'write' | 'run'
export interface TouchedFile { path: string; op: FileOp }

// ── File ontology extraction (the "internal ontology" of a touched file) ───────

export interface FileOntology { language: string; symbols: Array<{ name: string; kind: string }>; imports: string[] }

const langOf = (path: string): string => {
  const ext = (path.split('.').pop() ?? '').toLowerCase()
  return ({ py: 'python', ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript', rs: 'rust', go: 'go' } as Record<string, string>)[ext] ?? 'text'
}

/** Pull top-level symbols + imports from source. Regex-based, language-aware, best-effort. */
export function extractFileOntology(path: string, content: string): FileOntology {
  const language = langOf(path)
  const symbols: Array<{ name: string; kind: string }> = []
  const imports = new Set<string>()
  const push = (name: string, kind: string) => { if (name && !symbols.some((s) => s.name === name)) symbols.push({ name, kind }) }

  if (language === 'python') {
    for (const m of content.matchAll(/^\s*def\s+([A-Za-z_]\w*)/gm)) push(m[1]!, 'function')
    for (const m of content.matchAll(/^\s*class\s+([A-Za-z_]\w*)/gm)) push(m[1]!, 'class')
    for (const m of content.matchAll(/^\s*(?:from\s+([\w.]+)\s+import|import\s+([\w.]+))/gm)) imports.add((m[1] ?? m[2] ?? '').split('.')[0]!)
  } else if (language === 'typescript' || language === 'javascript') {
    for (const m of content.matchAll(/(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g)) push(m[1]!, 'function')
    for (const m of content.matchAll(/(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/g)) push(m[1]!, 'class')
    for (const m of content.matchAll(/export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) push(m[1]!, 'export')
    for (const m of content.matchAll(/(?:^|\n)\s*(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(/g)) push(m[1]!, 'function')
    for (const m of content.matchAll(/(?:import[^'"]*from\s+|require\(\s*)['"]([^'"]+)['"]/g)) imports.add(m[1]!)
  } else if (language === 'rust') {
    for (const m of content.matchAll(/\bfn\s+([A-Za-z_]\w*)/g)) push(m[1]!, 'function')
    for (const m of content.matchAll(/\b(?:struct|enum|trait)\s+([A-Za-z_]\w*)/g)) push(m[1]!, 'type')
  }
  return { language, symbols: symbols.slice(0, 40), imports: [...imports].filter(Boolean).slice(0, 20) }
}

// ── Graph writes ───────────────────────────────────────────────────────────────

/** Create/refresh the Session atom. */
export function ensureSession(store: GraphStore, sessionId: string, now = new Date().toISOString()): string {
  const id = SESSION(sessionId)
  const existing = store.getNode(id)
  if (!existing) store.addNode(id, ['Session', 'GaiaEntity'], { session_id: sessionId, created_at: now, last_seen: now, turn_count: 0, status: 'active' })
  else { existing.properties['last_seen'] = now }
  return id
}

/** Create/refresh a File atom and (re-)extract its symbol ontology into the graph. */
export function recordFileAtom(store: GraphStore, absPath: string, op: FileOp, now = new Date().toISOString()): string {
  const id = FILE(absPath)
  const node = store.getNode(id)
  if (!node) store.addNode(id, ['File'], { path: absPath, language: langOf(absPath), last_op: op, touched_at: now, touches: 1 })
  else { node.properties['last_op'] = op; node.properties['touched_at'] = now; node.properties['touches'] = (Number(node.properties['touches'] ?? 0) || 0) + 1 }

  // Ontologize on read/edit/write (not run); skip if we already have symbols and the file is unchanged-ish.
  if (op !== 'run') {
    try {
      const content = fs.readFileSync(absPath, 'utf8')
      if (content.length <= 400_000) {
        const onto = extractFileOntology(absPath, content)
        const cur = store.getNode(id)!
        cur.properties['imports'] = onto.imports.join(', ')
        cur.properties['symbol_count'] = onto.symbols.length
        for (const s of onto.symbols) {
          const sid = SYMBOL(absPath, s.name)
          if (!store.getNode(sid)) store.addNode(sid, ['Symbol'], { name: s.name, kind: s.kind, file: absPath, created_at: now })
          store.addEdge('HAS_SYMBOL', id, sid, { kind: s.kind })
        }
      }
    } catch { /* unreadable / binary — keep the File atom without symbols */ }
  }
  return id
}

export interface TurnInput {
  sessionId: string
  turnNum: number
  intent?: string
  model?: string
  userText?: string
  answerText?: string
  filesTouched?: TouchedFile[]
  grounded?: boolean
  worth?: number
  goalId?: string
}

/** Write a Turn atom and its edges: Session─HAS_TURN→Turn─TOUCHED→File, Turn─PROGRESSES→Goal. */
export function recordTurnAtom(store: GraphStore, t: TurnInput, now = new Date().toISOString()): string {
  const sid = ensureSession(store, t.sessionId, now)
  const tid = TURN(t.sessionId, t.turnNum)
  store.addNode(tid, ['Turn'], {
    session_id: t.sessionId, turn: t.turnNum, intent: t.intent ?? '', model: t.model ?? '',
    prompt_summary: (t.userText ?? '').slice(0, 280), response_summary: (t.answerText ?? '').slice(0, 280),
    grounded: !!t.grounded, worth: t.worth ?? 0, created_at: now,
  })
  store.addEdge('HAS_TURN', sid, tid, { turn: t.turnNum, at: now })
  const sNode = store.getNode(sid)
  if (sNode) sNode.properties['turn_count'] = Math.max(Number(sNode.properties['turn_count'] ?? 0) || 0, t.turnNum + 1)

  for (const f of t.filesTouched ?? []) {
    const fid = recordFileAtom(store, f.path, f.op, now)
    store.addEdge('TOUCHED', tid, fid, { op: f.op, at: now })
  }
  if (t.goalId && store.getNode(t.goalId)) {
    store.addEdge('PROGRESSES', tid, t.goalId, { at: now })
    store.addEdge('HAS_GOAL', sid, t.goalId, { at: now })
  }
  return tid
}

// ── Goal write-back (the frozen-goal fix) ──────────────────────────────────────

export interface GoalLike { objective: string; subtasks: Array<{ title: string; done: boolean }>; slots: Array<{ name: string; filled: boolean; value?: string }> }

/**
 * Advance goal progress from a turn's outcome: mark a subtask done when the answer/files
 * clearly evidence it, fill a slot when its name shows up. Pure — caller saves the result.
 * Returns the number of newly-completed subtasks + filled slots (0 = no change).
 */
export function advanceGoalFromOutcome(goal: GoalLike, answerText: string, filesTouched: TouchedFile[]): number {
  const hay = `${answerText}\n${filesTouched.map((f) => `${f.op} ${f.path}`).join('\n')}`.toLowerCase()
  const tokens = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length >= 4))
  let changed = 0
  for (const st of goal.subtasks) {
    if (st.done) continue
    const stTok = [...tokens(st.title)]
    if (stTok.length >= 2 && stTok.filter((w) => hay.includes(w)).length >= Math.ceil(stTok.length * 0.6)) { st.done = true; changed++ }
  }
  for (const sl of goal.slots) {
    if (sl.filled) continue
    if (sl.name && hay.includes(sl.name.toLowerCase())) { sl.filled = true; changed++ }
  }
  return changed
}

// ── Read: re-derive the session brief from atoms (the re-injected context) ──────

/** A compact, graph-derived view of the session for the next turn's prompt. */
export function buildSessionContext(store: GraphStore, sessionId: string, opts: { maxTurns?: number; maxFiles?: number } = {}): string {
  const sid = SESSION(sessionId)
  if (!store.getNode(sid)) return ''
  const lines: string[] = []

  // Recent turns (objective continuity over a long session).
  const turns = store.out(sid, 'HAS_TURN')
    .filter((n) => n.labels.includes('Turn'))
    .sort((a, b) => (Number(b.properties['turn'] ?? 0) || 0) - (Number(a.properties['turn'] ?? 0) || 0))
    .slice(0, opts.maxTurns ?? 5)
  if (turns.length > 0) {
    lines.push('Recent turns this session:')
    for (const t of [...turns].reverse()) {
      const intent = String(t.properties['intent'] ?? '').trim()
      const ps = String(t.properties['prompt_summary'] ?? '').slice(0, 90)
      lines.push(`  • #${t.properties['turn']}${intent ? ` [${intent}]` : ''}: ${ps}`)
    }
  }

  // Files touched this session + their ontology (repo-scale context without re-reading).
  const fileNodes = new Map<string, GraphNodeLike>()
  for (const t of store.out(sid, 'HAS_TURN')) for (const f of store.out(t.id, 'TOUCHED')) if (f.labels.includes('File')) fileNodes.set(f.id, f)
  const files = [...fileNodes.values()]
    .sort((a, b) => String(b.properties['touched_at'] ?? '').localeCompare(String(a.properties['touched_at'] ?? '')))
    .slice(0, opts.maxFiles ?? 8)
  if (files.length > 0) {
    lines.push('Files in play this session (with their symbols):')
    for (const f of files) {
      const syms = store.out(f.id, 'HAS_SYMBOL').filter((s) => s.labels.includes('Symbol')).map((s) => String(s.properties['name'])).slice(0, 12)
      const imp = String(f.properties['imports'] ?? '')
      lines.push(`  • ${f.properties['path']} (${f.properties['last_op']})${syms.length ? ` — defines: ${syms.join(', ')}` : ''}${imp ? ` — imports: ${imp}` : ''}`)
    }
  }

  if (lines.length === 0) return ''
  return `\n\n---\n**Session memory** (from the knowledge graph — your work so far):\n${lines.join('\n')}`
}
