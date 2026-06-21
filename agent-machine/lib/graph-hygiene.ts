/**
 * graph-hygiene — the cleanup workflow for the knowledge graph.
 *
 * The graph accretes junk: directory/path atoms, shell commands, hashes, non-semantic
 * concatenations, near-duplicate spellings (notca ×3, case variants), and hundreds of orphans.
 * This runs the pass the way you'd clean any lexical graph:
 *
 *   1. NORMALIZE   — case-fold, collapse whitespace, strip wrapping punctuation.
 *   2. CLASSIFY    — path | command | hash | non-semantic | entity | concept.
 *   3. SPELL-CHECK — token vs an English/tech/project lexicon; flag + suggest a correction.
 *   4. DEDUP       — edit-distance + token similarity → merge near-duplicates onto a canonical.
 *   5. ORPHANS     — for each unlinked node, attach (nearest concept / taxonomy) or prune.
 *   6. APPLY       — non-destructively: mark `hygiene_pruned` / `hygiene_merged_into` so the
 *                    surface hides them; fully reversible + auditable (no hard deletes).
 *
 * Read-only `report()` produces the plan; `apply()` (caller-gated) stamps the marks.
 */

export interface HygieneNode { id: string; label: string; labelType: string; degree: number }

export type LabelClass = 'path' | 'command' | 'hash' | 'nonsemantic' | 'entity' | 'concept'

const COMMANDS = new Set(['bash', 'sh', 'zsh', 'npm', 'npx', 'node', 'git', 'python', 'python3', 'pip', 'pip3', 'cd', 'ls', 'cat', 'echo', 'rm', 'mkdir', 'touch', 'curl', 'wget', 'brew', 'cargo', 'bun', 'make', 'sudo', 'cp', 'mv', 'grep', 'sed', 'awk'])
// Known project/tech terms that must NEVER be flagged as misspellings (they're real, just not in a dictionary).
const LEXICON = new Set(['noetica', 'hellgraph', 'graphbrain', 'ollama', 'tauri', 'qwen', 'deepseek', 'llama', 'sidecar', 'concierge', 'prophet', 'sociosphere', 'socioprophet', 'membrane', 'embeddings', 'retrieval', 'governance', 'guardrail', 'provenance', 'taxonomy', 'cluster', 'vector', 'token', 'ngram', 'rocksdb', 'sqlite', 'webkit', 'rust', 'typescript', 'react', 'vite', 'css', 'html', 'api', 'cli', 'sdk', 'llm', 'rag', 'mesh', 'atom', 'atomspace'])

function normalize(s: string): string {
  return s.trim().replace(/\s+/g, ' ').replace(/^[\s"'`([{<]+|[\s"'`)\]}>]+$/g, '')
}
function toks(s: string): string[] {
  return s.toLowerCase().replace(/([a-z])([A-Z])/g, '$1 $2').split(/[^a-z0-9]+/i).filter(Boolean)
}
function vowelRatio(w: string): number {
  const v = (w.match(/[aeiou]/gi) ?? []).length
  return w.length ? v / w.length : 0
}

/** Classify a single label. `lexicon` lets the caller pass a dynamic dictionary (e.g. taxonomy words). */
export function classifyLabel(label: string, lexicon: (w: string) => boolean): LabelClass {
  const l = normalize(label)
  if (!l) return 'nonsemantic'
  if (l.includes('/') || l.includes('\\') || /^[.~]/.test(l) || /\.(md|json|txt|log|tmp|lock|ts|js|py|rs|toml|yaml|yml)$/i.test(l)) return 'path'
  const ws = toks(l)
  if (ws.length && ws.every((w) => COMMANDS.has(w))) return 'command'
  if (/^[a-f0-9]{6,}$/i.test(l.replace(/[\s_-]/g, '')) || /^[a-z]?\d{3,}[a-z]?$/i.test(l)) return 'hash'
  // entity: looks like a proper noun / identifier (snake_case, CamelCase, or capitalized multiword)
  if (l.includes('_') || /[a-z][A-Z]/.test(l) || (/^[A-Z]/.test(l) && ws.length >= 2)) return 'entity'
  // non-semantic: a word the lexicon doesn't know AND that's consonant-heavy (a disemvowelled/garbled token)
  const unknownGarbled = ws.some((w) => w.length >= 5 && !lexicon(w) && vowelRatio(w) < 0.25)
  if (unknownGarbled) return 'nonsemantic'
  return 'concept'
}

/** Levenshtein distance (capped — early-exit once it exceeds `max`). */
export function editDistance(a: string, b: string, max = 99): number {
  if (a === b) return 0
  if (Math.abs(a.length - b.length) > max) return max + 1
  const m = a.length, n = b.length
  let prev = Array.from({ length: n + 1 }, (_, j) => j)
  for (let i = 1; i <= m; i++) {
    const cur = [i]
    let rowMin = i
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      const v = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost)
      cur[j] = v; if (v < rowMin) rowMin = v
    }
    if (rowMin > max) return max + 1
    prev = cur
  }
  return prev[n]!
}

/** Normalized similarity in [0,1] — 1 = identical. */
export function similarity(a: string, b: string): number {
  const la = a.toLowerCase(), lb = b.toLowerCase()
  const d = editDistance(la, lb)
  return 1 - d / Math.max(la.length, lb.length, 1)
}

export interface DuplicateGroup { canonical: string; canonicalId: string; members: HygieneNode[] }

/**
 * Cluster near-duplicate labels (case variants, ≤2 edits, or ≥0.82 similar). The canonical is the
 * highest-degree, most-vowel-balanced, dictionary-valid member. Returns only groups with ≥2 members.
 */
export function findDuplicateGroups(nodes: HygieneNode[], lexicon: (w: string) => boolean): DuplicateGroup[] {
  const sorted = [...nodes].sort((a, b) => b.degree - a.degree)
  const used = new Set<string>()
  const groups: DuplicateGroup[] = []
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i]!
    if (used.has(a.id)) continue
    const norm = (s: string) => s.toLowerCase().replace(/[\s_/-]+/g, ' ').trim()
    const an = norm(a.label)
    const members: HygieneNode[] = [a]
    for (let j = i + 1; j < sorted.length; j++) {
      const b = sorted[j]!
      if (used.has(b.id)) continue
      const bn = norm(b.label)
      if (an === bn || editDistance(an, bn, 2) <= 2 || similarity(an, bn) >= 0.82) members.push(b)
    }
    if (members.length >= 2) {
      // canonical = best-spelled, highest-degree member (prefer one the lexicon knows / vowel-balanced)
      const canon = members.slice().sort((x, y) => {
        const sx = (toks(x.label).every(lexicon) ? 2 : 0) + (vowelRatio(x.label) >= 0.3 ? 1 : 0) + x.degree * 0.001
        const sy = (toks(y.label).every(lexicon) ? 2 : 0) + (vowelRatio(y.label) >= 0.3 ? 1 : 0) + y.degree * 0.001
        return sy - sx
      })[0]!
      for (const m of members) used.add(m.id)
      groups.push({ canonical: canon.label, canonicalId: canon.id, members })
    } else { used.add(a.id) }
  }
  return groups
}

export interface OrphanDisposition { id: string; label: string; action: 'prune' | 'attach' | 'keep'; attachTo?: string; reason: string }

/**
 * For each orphan (degree 0), decide: prune (junk class), attach (near a non-orphan concept), or
 * keep (a valid standalone concept). Attachment is by best label similarity to a connected node.
 */
export function analyzeOrphans(orphans: HygieneNode[], connected: HygieneNode[], lexicon: (w: string) => boolean): OrphanDisposition[] {
  return orphans.map((o) => {
    const cls = classifyLabel(o.label, lexicon)
    if (cls === 'path' || cls === 'command' || cls === 'hash' || cls === 'nonsemantic') {
      return { id: o.id, label: o.label, action: 'prune', reason: `junk class: ${cls}` }
    }
    let best: { node: HygieneNode; sim: number } | null = null
    for (const c of connected) {
      const sim = similarity(o.label, c.label)
      if (!best || sim > best.sim) best = { node: c, sim }
    }
    if (best && best.sim >= 0.8) return { id: o.id, label: o.label, action: 'attach', attachTo: best.node.id, reason: `≈ "${best.node.label}" (${best.sim.toFixed(2)})` }
    return { id: o.id, label: o.label, action: 'keep', reason: `valid ${cls}, no near attachment` }
  })
}

export interface HygieneReport {
  total: number
  byClass: Record<LabelClass, number>
  spellFlags: { label: string; suggest: string | null }[]
  duplicateGroups: { canonical: string; members: string[] }[]
  orphans: { prune: number; attach: number; keep: number; samples: OrphanDisposition[] }
  prunable: string[]   // ids safe to prune (junk classes)
}

/** Build the full hygiene plan over a graph snapshot (read-only). */
export function buildReport(
  nodes: HygieneNode[],
  edges: { from: string; to: string }[],
  taxonomyWords: Set<string>,
): HygieneReport {
  const lexicon = (w: string) => w.length <= 2 || LEXICON.has(w) || taxonomyWords.has(w) || /^[a-z]+$/i.test(w) && vowelRatio(w) >= 0.3
  const byClass: Record<LabelClass, number> = { path: 0, command: 0, hash: 0, nonsemantic: 0, entity: 0, concept: 0 }
  const prunable: string[] = []
  const spellFlags: { label: string; suggest: string | null }[] = []
  for (const n of nodes) {
    const cls = classifyLabel(n.label, lexicon)
    byClass[cls]++
    if (cls === 'path' || cls === 'command' || cls === 'hash') prunable.push(n.id)
    if (cls === 'nonsemantic') {
      // suggest the nearest known word
      let best: { w: string; d: number } | null = null
      const word = toks(n.label)[0] ?? n.label
      for (const cand of LEXICON) { const d = editDistance(word, cand, 3); if (d <= 3 && (!best || d < best.d)) best = { w: cand, d } }
      spellFlags.push({ label: n.label, suggest: best?.w ?? null })
    }
  }
  const deg = new Map<string, number>()
  for (const e of edges) { deg.set(e.from, (deg.get(e.from) ?? 0) + 1); deg.set(e.to, (deg.get(e.to) ?? 0) + 1) }
  const withDeg = nodes.map((n) => ({ ...n, degree: deg.get(n.id) ?? 0 }))
  const groups = findDuplicateGroups(withDeg, lexicon)
  const orphanNodes = withDeg.filter((n) => n.degree === 0)
  const connected = withDeg.filter((n) => n.degree > 0)
  const dispositions = analyzeOrphans(orphanNodes, connected, lexicon)
  return {
    total: nodes.length,
    byClass,
    spellFlags: spellFlags.slice(0, 50),
    duplicateGroups: groups.slice(0, 50).map((g) => ({ canonical: g.canonical, members: g.members.map((m) => m.label) })),
    orphans: {
      prune: dispositions.filter((d) => d.action === 'prune').length,
      attach: dispositions.filter((d) => d.action === 'attach').length,
      keep: dispositions.filter((d) => d.action === 'keep').length,
      samples: dispositions.slice(0, 30),
    },
    prunable,
  }
}
