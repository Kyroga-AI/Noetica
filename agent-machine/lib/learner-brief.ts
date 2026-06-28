// learner-brief — the "Learn" primer. When a new chat workspace opens, assemble what the assistant should
// already know about THIS learner, sourced from the Alexandrian Academy (their degree, completed vs remaining
// courses, the prerequisite frontier they're ready for, the domain teaching persona) and the Noetica canon
// (the definition + cross-domain bridges for their current focus) — NOT from personal Gmail/Drive. The result
// is injected into the new-session system prompt so the tutor meets the learner where they are.
//
// Learner state lives in academy/learners/<id>.json (the only non-static piece; everything else is the
// catalogue/registrar/canon we already hold). No profile → empty brief → zero behavioural change.
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { canonDef, canonBridges } from './canon-lookup.js'

const ACADEMY = process.env['ACADEMY_DIR'] || join(__dirname, '..', 'academy')
const CANON = process.env['CANON_DIR'] || join(__dirname, '..', 'canon')

export interface LearnerProfile {
  learnerId: string
  name?: string
  degree: string        // registrar key → registrar-<degree>.json (e.g. 'mathematics', 'physics_phd')
  completed?: string[]  // completed course codes, e.g. ['18.01','18.02']
  focus?: string        // current topic/course of interest (drives canon context)
}
interface Course { n: string; title?: string; u?: number; captured?: boolean; persona?: string; prereq?: string[] }

const loadJSON = (p: string): any => JSON.parse(readFileSync(p, 'utf8'))

export function loadLearnerProfile(learnerId: string): LearnerProfile | null {
  try {
    const p = join(ACADEMY, 'learners', `${learnerId}.json`)
    return existsSync(p) ? loadJSON(p) : null
  } catch { return null }
}

/** The "Learn" brief: a compact context block priming the tutor with the learner's academic state. Returns
 *  '' when there's no profile (or any read fails) so injection is always safe. */
export function buildLearnerBrief(learnerId: string): string {
  try {
    const prof = loadLearnerProfile(learnerId)
    if (!prof?.degree) return ''
    const regPath = join(ACADEMY, `registrar-${prof.degree}.json`)
    if (!existsSync(regPath)) return ''
    const reg = loadJSON(regPath)
    const cat = existsSync(join(ACADEMY, 'catalogue.json')) ? loadJSON(join(ACADEMY, 'catalogue.json')) : {}
    const domain: string = reg.domain || prof.degree
    const personaInfo = cat.personas?.[domain] ?? {}
    const persona: string | undefined = personaInfo.persona
    const method: string | undefined = personaInfo.method

    const all: Course[] = (reg.requirements || []).flatMap((r: any) => r.subjects || [])
    const done = new Set(prof.completed || [])
    const completed = all.filter((c) => done.has(c.n))
    const remaining = all.filter((c) => !done.has(c.n))
    // the prerequisite FRONTIER: remaining courses whose prereqs are all already completed → learnable now
    const frontier = remaining.filter((c) => (c.prereq || []).every((p) => done.has(p)))

    // where they sit on the domain's topic learning path (induce-prereq-dag.py)
    const dag = existsSync(join(CANON, 'prereq-dag.json')) ? loadJSON(join(CANON, 'prereq-dag.json')) : {}
    const path: string[] = dag[domain]?.learning_path || []

    // canon context for the current focus (definition + cross-domain bridges)
    let focusCtx = ''
    if (prof.focus) {
      const def = canonDef(prof.focus)
      const br = canonBridges(prof.focus)
      if (def) focusCtx = `Focus — "${prof.focus}": ${def}` + (br.length ? `  (connects to: ${br.slice(0, 4).join(', ')})` : '')
    }

    const totalU = all.reduce((a, c) => a + (c.u || 0), 0)
    const doneU = completed.reduce((a, c) => a + (c.u || 0), 0)
    const fmt = (c: Course) => `${c.n}${c.title ? ' ' + c.title : ''}`
    const lines = [
      `## Learner Context (Alexandrian Academy)`,
      `Learner: ${prof.name || learnerId}  ·  Degree: ${reg.program || prof.degree}`,
      `Progress: ${completed.length}/${all.length} subjects` + (totalU ? `  (${doneU}/${totalU} units)` : ''),
      frontier.length ? `Ready to take now (prerequisites met): ${frontier.slice(0, 6).map(fmt).join(' · ')}` : '',
      path.length ? `Domain learning path: ${path.slice(0, 8).join(' → ')}${path.length > 8 ? ' → …' : ''}` : '',
      persona ? `Teach as ${persona}${method ? ` — ${method}` : ''}.` : '',
      focusCtx,
      `Meet the learner where they are: assume what they've completed, scaffold from their prerequisite frontier, and don't re-teach mastered material.`,
    ].filter(Boolean)
    return lines.join('\n')
  } catch { return '' }
}
