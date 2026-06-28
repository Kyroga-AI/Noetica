// progress — the AUDIENCE layer. The walk and the coverage are level-agnostic (learning-path.ts); only the
// VOICE and the progress ARTIFACT change by who the learner is. This de-niches the product: a child gets
// "teach to curiosity" + a homeschool portfolio; a student gets a degree brief + transcript; an adult gets a
// direct "path to job-ready" brief + a skills certificate — NO grades, NO "compliance", no childlike framing
// ever reaches an adult. One engine, three lenses, selected by track.
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { buildLearnerBrief } from './learner-brief.js'
import { buildK12Brief, buildK12Portfolio } from './k12-portfolio.js'
import { pathTo } from './learning-path.js'

const ACADEMY = process.env['ACADEMY_DIR'] || join(__dirname, '..', 'academy')

interface Profile {
  learnerId: string; name?: string; track?: string
  degree?: string; goal?: string; completed?: string[]; k12_completed?: string[]; interests?: string[]
}

function loadProfile(id: string): Profile | null {
  try {
    const p = join(ACADEMY, 'learners', `${id}.json`)
    return existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as Profile) : null
  } catch { return null }
}

export type Track = 'k12' | 'degree' | 'professional'

/** Which audience is this — so we pick the right voice + artifact. Explicit `track` wins; else inferred. */
export function learnerTrack(id: string): Track | null {
  const p = loadProfile(id)
  if (!p) return null
  if (p.track === 'k12' || p.track === 'degree' || p.track === 'professional') return p.track
  if (p.k12_completed?.length) return 'k12'
  if (p.degree) return 'degree'
  if (p.goal) return 'professional'
  if (p.interests?.length) return 'k12'
  return 'professional'
}

/** The professional/adult brief — path to the goal, gaps, next step. Direct voice, no childlike framing. */
function buildProfessionalBrief(id: string): string {
  const p = loadProfile(id)
  if (!p?.goal) return ''
  const full = pathTo(p.goal, [])
  const rem = pathTo(p.goal, p.completed ?? [])
  if (!full || !rem) return ''
  const total = full.path.length || 1
  const pct = Math.round(100 * (total - rem.path.length) / total)
  return [
    `## Learner Context (Alexandrian Academy — self-directed adult)`,
    `Learner: ${p.name ?? id}  ·  Goal: ${rem.resolved}`,
    `Progress to goal: ~${pct}%  ·  ${rem.path.length} competencies remaining${rem.levels.length ? `  (${rem.levels.join(' → ')})` : ''}`,
    rem.path.length ? `Next up: ${rem.path.slice(0, 4).map((n) => n.name).join(' → ')}` : `Goal reached — ready.`,
    `Teach for an adult: be direct, respect prior knowledge, tie every step to the goal, skip the grade-school framing.`,
  ].join('\n')
}

/** The system-prompt brief in the RIGHT voice for the learner's track. '' when no profile. */
export function buildAdaptiveBrief(id: string): string {
  const t = learnerTrack(id)
  if (!t) return ''
  if (t === 'k12') return buildK12Brief(id)
  if (t === 'degree') return buildLearnerBrief(id)
  return buildProfessionalBrief(id)
}

/** The professional skills certificate — competencies, readiness, what's next. No grades, no buckets. */
function buildSkillsCert(id: string): string {
  const p = loadProfile(id)
  if (!p?.goal) return ''
  const full = pathTo(p.goal, [])
  const rem = pathTo(p.goal, p.completed ?? [])
  if (!full || !rem) return ''
  const done = (full.path.length - rem.path.length)
  const gained = full.path.filter((n) => !rem.path.some((r) => r.id === n.id)).map((n) => n.name)
  return [
    `## Skills Certificate — ${p.name ?? id}`,
    `Track: ${rem.resolved}  ·  Readiness: ${done}/${full.path.length} competencies (~${Math.round(100 * done / (full.path.length || 1))}%)`,
    gained.length ? `Demonstrated: ${gained.join(' · ')}` : 'Just starting.',
    rem.path.length ? `Remaining: ${rem.path.map((n) => n.name).join(' · ')}` : 'Goal competencies complete — job-ready.',
  ].join('\n')
}

export interface Artifact { lens: Track; text: string }

/** The progress artifact in the RIGHT lens: homeschool portfolio (k12) / degree brief (degree) / skills cert
 *  (professional). Same underlying walk + coverage; the lens adapts so a kid's "portfolio" never reaches an adult. */
export function progressArtifact(id: string): Artifact | null {
  const t = learnerTrack(id)
  if (!t) return null
  if (t === 'k12') return { lens: 'k12', text: buildK12Portfolio(id).transcript }
  if (t === 'professional') return { lens: 'professional', text: buildSkillsCert(id) }
  return { lens: 'degree', text: buildLearnerBrief(id) }
}

// CLI self-test:  npx tsx lib/progress.ts demo-pro
if (process.argv[1] && process.argv[1].endsWith('progress.ts')) {
  const id = process.argv[2] || 'demo-pro'
  console.log(`track = ${learnerTrack(id)}\n`)
  console.log(buildAdaptiveBrief(id) || '(no brief)')
  console.log('\n' + (progressArtifact(id)?.text || '(no artifact)'))
}
