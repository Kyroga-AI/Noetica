// learning-path — the LEVEL-AGNOSTIC navigator. This is the Academy's actual product: follow curiosity to
// mastery at ANY level, on ONE prereq graph that spans K-12 foundations → the undergrad/grad canon. A
// 7-year-old into dinosaurs and a 30-year-old changing careers into machine learning use the SAME engine —
// pathTo(goal, fromCompleted) returns the walk from wherever the learner is to whatever they want. The
// homeschool portfolio / degree transcript / skills certificate are just progress LENSES on the same walk,
// not separate products. K-12 is one entry point, not the ceiling.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const ACADEMY = process.env['ACADEMY_DIR'] || join(__dirname, '..', 'academy')
const CANON = process.env['CANON_DIR'] || join(__dirname, '..', 'canon')
const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

export interface PathNode { id: string; name: string; level: string; subject: string; prereq: string[] }

/** The unified graph: K-12 foundation nodes + canon topics, wired by prereq, with the K-12→canon bridges. */
function loadGraph(): Map<string, PathNode> {
  const g = new Map<string, PathNode>()
  const byName = new Map<string, string>()                       // norm(name) → id (for goal resolution)
  // 1. K-12 foundations
  try {
    const f = JSON.parse(readFileSync(join(ACADEMY, 'k12-foundations.json'), 'utf8')) as {
      subjects: Record<string, { nodes: Array<{ id: string; name: string; prereq?: string[]; up?: string }> }>
    }
    for (const [subject, blk] of Object.entries(f.subjects)) {
      for (const n of blk.nodes) {
        g.set(n.id, { id: n.id, name: n.name, level: 'k12', subject, prereq: n.prereq ?? [] })
        byName.set(norm(n.name), n.id)
      }
    }
  } catch { /* foundations absent */ }
  // 2. canon topics + their prereqs (prereq-dag) + the K-12 bridges
  const dag = (() => { try { return JSON.parse(readFileSync(join(CANON, 'prereq-dag.json'), 'utf8')) as Record<string, { edges?: [string, string][] }> } catch { return {} } })()
  try {
    for (const file of readdirSync(CANON).filter((x) => x.startsWith('spec-') && x.endsWith('.json'))) {
      const spec = JSON.parse(readFileSync(join(CANON, file), 'utf8'))
      const domain: string = spec.domain ?? file.slice(5, -5)
      const edges = dag[domain]?.edges ?? []
      for (const t of spec.topics ?? []) {
        if (!t.topic) continue
        const id = `topic:${norm(t.topic)}`
        const prereq = edges.filter(([a]) => norm(a) === norm(t.topic)).map(([, b]) => `topic:${norm(b)}`)   // A requires B
        g.set(id, { id, name: t.topic, level: String(t.level ?? 'undergrad'), subject: domain, prereq })
        byName.set(norm(t.topic), id)
      }
    }
    // bridges: a canon topic that a K-12 node feeds (its `up`) gains that K-12 node as a prerequisite
    const f = JSON.parse(readFileSync(join(ACADEMY, 'k12-foundations.json'), 'utf8')) as {
      subjects: Record<string, { nodes: Array<{ id: string; up?: string }> }>
    }
    for (const blk of Object.values(f.subjects)) {
      for (const n of blk.nodes) {
        if (n.up) { const ct = g.get(`topic:${norm(n.up)}`); if (ct && !ct.prereq.includes(n.id)) ct.prereq.push(n.id) }
      }
    }
  } catch { /* canon absent */ }
  ;(g as unknown as { _byName: Map<string, string> })._byName = byName
  return g
}

/** Resolve a goal string to a node id: a topic, a K-12 node name, or a FIELD/domain (→ its most-advanced topic). */
function resolveGoal(goal: string, g: Map<string, PathNode>): string | null {
  const byName = (g as unknown as { _byName: Map<string, string> })._byName
  const k = norm(goal)
  if (byName.has(k)) return byName.get(k)!
  for (const [nm, id] of byName) if (nm.includes(k) || k.includes(nm)) return id   // fuzzy
  // a field/domain → its highest-level topic (the field's "mastery" target)
  const inDom = [...g.values()].filter((n) => n.subject === k)
  if (inDom.length) { const adv = inDom.find((n) => n.level === 'grad') ?? inDom.find((n) => n.level === 'undergrad') ?? inDom[inDom.length - 1]; return adv!.id }
  return null
}

export interface LearningPath { goal: string; resolved: string; path: PathNode[]; levels: string[]; from: number }

/**
 * The walk from `fromCompleted` to `goal`, on the unified K-12→canon graph. Level-agnostic: works for a kid
 * (goal="biology", from=[]) and an adult (goal="machine learning", from=[completed HS nodes]) alike.
 */
export function pathTo(goal: string, fromCompleted: string[] = []): LearningPath | null {
  const g = loadGraph()
  const target = resolveGoal(goal, g)
  if (!target) return null
  const done = new Set(fromCompleted.map((x) => (g.has(x) ? x : `topic:${norm(x)}`)))
  const order: string[] = []; const seen = new Set<string>()
  const visit = (id: string): void => {
    if (seen.has(id) || !g.has(id)) return
    seen.add(id)
    for (const p of g.get(id)!.prereq) visit(p)
    order.push(id)
  }
  visit(target)
  const path = order.filter((id) => !done.has(id)).map((id) => g.get(id)!)
  return { goal, resolved: g.get(target)!.name, path, levels: [...new Set(path.map((n) => n.level))], from: done.size }
}

// CLI self-test:  npx tsx lib/learning-path.ts "machine learning"
if (process.argv[1] && process.argv[1].endsWith('learning-path.ts')) {
  for (const [goal, from] of [['biology', []], ['machine learning', []], ['machine learning', ['m.prealg', 'topic:single variable calculus', 'topic:linear algebra']]] as Array<[string, string[]]>) {
    const r = pathTo(goal, from)
    console.log(`\nGOAL: "${goal}"  (from ${from.length} completed)`)
    if (!r) { console.log('  (unresolved)'); continue }
    console.log(`  → ${r.resolved}  ·  ${r.path.length} steps  ·  levels: ${r.levels.join(' → ')}`)
    console.log(`  path: ${r.path.slice(0, 10).map((n) => n.name).join(' → ')}${r.path.length > 10 ? ' → …' : ''}`)
  }
}
