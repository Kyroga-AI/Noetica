// k12-portfolio — the homeschool COMPLIANCE artifact. Given a K-12 learner's completed foundation nodes,
// produce the portfolio/transcript a parent can submit: which compliance buckets are covered (and how much),
// the curriculum actually walked (by subject), an instructional-hours estimate, the bridges reached into the
// college canon, and the gaps. The point: compliance falls out as a BYPRODUCT of the interest-driven walk —
// the kid follows dinosaurs, the system reports "covered science, math, and data." Reads the same learner
// profile as learner-brief.ts (academy/learners/<id>.json), using its k12_completed list.
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const ACADEMY = process.env['ACADEMY_DIR'] || join(__dirname, '..', 'academy')
const HOURS_PER_NODE = Number(process.env['K12_HOURS_PER_NODE'] || 30)   // rough instructional hours per foundation unit

export interface K12Profile { learnerId: string; name?: string; k12_completed?: string[]; interests?: string[] }
interface K12Node { id: string; name: string; grade: string; bucket: string; subject: string; prereq: string[]; up?: string }

function loadFoundations(): { nodes: Map<string, K12Node>; buckets: string[] } {
  const f = JSON.parse(readFileSync(join(ACADEMY, 'k12-foundations.json'), 'utf8')) as {
    buckets: string[]
    subjects: Record<string, { bucket: string; nodes: Array<{ id: string; name: string; grade?: string; prereq?: string[]; up?: string }> }>
  }
  const nodes = new Map<string, K12Node>()
  for (const [subject, blk] of Object.entries(f.subjects)) {
    for (const n of blk.nodes) nodes.set(n.id, { id: n.id, name: n.name, grade: n.grade ?? '', bucket: blk.bucket, subject, prereq: n.prereq ?? [], up: n.up })
  }
  return { nodes, buckets: f.buckets }
}

interface NavEntry { fields: string[]; path: string[]; buckets: string[]; bridges_into_canon: string[]; hook: string }
function loadNavigator(): Record<string, NavEntry> {
  try { return JSON.parse(readFileSync(join(ACADEMY, 'k12-navigator.json'), 'utf8')) as Record<string, NavEntry> } catch { return {} }
}

/** Resolve an interest to its field(s) + the walkable path (for the product's "I want to learn about X"). */
export function k12Navigate(interest: string): NavEntry | null {
  const nav = loadNavigator()
  const k = interest.toLowerCase().trim()
  return nav[k] ?? Object.entries(nav).find(([key]) => key.includes(k) || k.includes(key))?.[1] ?? null
}

export function loadK12Profile(learnerId: string): K12Profile | null {
  try {
    const p = join(ACADEMY, 'learners', `${learnerId}.json`)
    return existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as K12Profile) : null
  } catch { return null }
}

export interface K12Portfolio {
  learner: string
  completed: number
  hours: number
  buckets: Array<{ bucket: string; done: number; total: number; hours: number; covered: boolean }>
  bySubject: Record<string, string[]>
  bridges: string[]
  gaps: string[]
}

/** Build the homeschool portfolio + a human-readable transcript. Returns nulls when there's no profile. */
export function buildK12Portfolio(learnerId: string): { portfolio: K12Portfolio | null; transcript: string } {
  try {
    const prof = loadK12Profile(learnerId)
    if (!prof) return { portfolio: null, transcript: '' }
    const { nodes, buckets } = loadFoundations()
    const done = new Set(prof.k12_completed ?? [])
    const totalByBucket: Record<string, number> = {}
    const doneByBucket: Record<string, number> = {}
    for (const n of nodes.values()) totalByBucket[n.bucket] = (totalByBucket[n.bucket] ?? 0) + 1
    const bySubject: Record<string, string[]> = {}
    const bridges: string[] = []
    for (const id of done) {
      const n = nodes.get(id)
      if (!n) continue
      doneByBucket[n.bucket] = (doneByBucket[n.bucket] ?? 0) + 1
      ;(bySubject[n.subject] ??= []).push(n.name)
      if (n.up) bridges.push(n.up)
    }
    const bucketRows = buckets.map((b) => ({
      bucket: b, done: doneByBucket[b] ?? 0, total: totalByBucket[b] ?? 0,
      hours: (doneByBucket[b] ?? 0) * HOURS_PER_NODE, covered: (doneByBucket[b] ?? 0) > 0,
    }))
    const gaps = bucketRows.filter((r) => r.total > 0 && !r.covered).map((r) => r.bucket)
    const portfolio: K12Portfolio = {
      learner: prof.name ?? learnerId, completed: done.size, hours: done.size * HOURS_PER_NODE,
      buckets: bucketRows, bySubject, bridges: [...new Set(bridges)], gaps,
    }
    const lines = [
      `## Homeschool Portfolio — ${portfolio.learner}`,
      `Completed: ${portfolio.completed} units  ·  ~${portfolio.hours} instructional hours (est.)`,
      ``,
      `Subject coverage (the compliance buckets):`,
      ...bucketRows.filter((r) => r.total > 0).map((r) => `  - ${r.bucket.padEnd(15)} ${r.done}/${r.total}  ~${r.hours}h${r.covered ? '' : '   ⚠ not yet started'}`),
      ``,
      `Curriculum record (what was actually studied):`,
      ...Object.entries(bySubject).map(([s, ns]) => `  ${s}: ${ns.join(' · ')}`),
      portfolio.bridges.length ? `\nReady for college-level study in: ${portfolio.bridges.join(', ')}` : '',
      portfolio.gaps.length ? `\nCompliance note — required buckets not yet started: ${portfolio.gaps.join(', ')} (add a node from each to satisfy most states).`
        : `\nAll required subject buckets have coverage ✓`,
    ].filter((x) => x !== null && x !== undefined)
    return { portfolio, transcript: lines.join('\n') }
  } catch {
    return { portfolio: null, transcript: '' }
  }
}

/** The K-12 learner brief for the Learn flow: interests → fields → next learnable step + the frontier + the
 *  compliance snapshot, so the tutor meets a self-directed child where their curiosity is. '' if not K-12. */
export function buildK12Brief(learnerId: string): string {
  try {
    const prof = loadK12Profile(learnerId)
    if (!prof || !((prof.k12_completed?.length ?? 0) || (prof.interests?.length ?? 0))) return ''
    const { nodes } = loadFoundations()
    const done = new Set(prof.k12_completed ?? [])
    const frontier = [...nodes.values()].filter((n) => !done.has(n.id) && n.prereq.every((p) => done.has(p)))   // learnable now
    const byName = new Map([...nodes.values()].map((n) => [n.name, n] as const))
    const interestLines = (prof.interests ?? []).map((it) => {
      const d = k12Navigate(it)
      if (!d) return `- ${it}`
      const next = d.path.find((nm) => { const nd = byName.get(nm); return nd && !done.has(nd.id) })
      return `- ${it} → ${d.fields.join('/')}${next ? ` · next step: ${next}` : ' · path complete'}`
    })
    const { portfolio } = buildK12Portfolio(learnerId)
    return [
      `## Learner Context (Alexandrian Academy — K-12, self-directed)`,
      `Learner: ${prof.name ?? learnerId}`,
      interestLines.length ? `Curious about → leads to:\n${interestLines.join('\n')}` : '',
      frontier.length ? `Ready to learn next: ${frontier.slice(0, 5).map((n) => n.name).join(' · ')}` : '',
      portfolio ? `Progress: ${portfolio.completed} units${portfolio.gaps.length ? ` · not yet touched: ${portfolio.gaps.join(', ')}` : ''}` : '',
      `Teach to the child's curiosity: start from what excites them, scaffold from their next learnable step, keep it concrete and playful — not grade-by-grade.`,
    ].filter(Boolean).join('\n')
  } catch { return '' }
}

// CLI self-test:  npx tsx lib/k12-portfolio.ts demo-k12
if (process.argv[1] && process.argv[1].endsWith('k12-portfolio.ts')) {
  const id = process.argv[2] || 'demo-k12'
  console.log(buildK12Brief(id) || '(no K-12 brief)')
  console.log('\n' + (buildK12Portfolio(id).transcript || `(no K-12 profile for ${id})`))
}
