/**
 * knowledge-domains — what subject domains the academic brain intends to cover, and how built each is.
 *
 * The academic brain is built per field (mathematics, physics, …). STEM is rich; medicine and legal are
 * DOMAIN corpora built the same way (scripts/fetch_{medical,legal}_corpus.py → vectorize_field.py → a
 * `<field>/*.jsonl` field with vectors). This reads the brain's own _manifest.json so you can SEE where
 * each domain stands — e.g. medicine is "thin" (staged, not yet ingested at scale), legal is "missing"
 * (pipeline ready, not run). No expensive corpus scan: it uses the manifest's per-field course counts.
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { academicBrainDir } from './brain-home.js'

// The domains we intend the academic brain to cover. The first 7 are the STEM core; medicine + legal are
// the regulated-knowledge domains built on demand.
export const EXPECTED_DOMAINS = [
  'mathematics', 'physics', 'chemistry', 'biology', 'biological_eng', 'eecs', 'earth_planetary',
  'medicine', 'legal',
] as const

export interface DomainStatus { field: string; present: boolean; courses: number; status: 'rich' | 'thin' | 'missing' }

function hasJsonl(dir: string): boolean {
  try { return fs.existsSync(dir) && fs.readdirSync(dir).some((f) => f.endsWith('.jsonl')) } catch { return false }
}

/** Per-domain readiness for the academic brain (from the brain manifest + field presence). */
export function domainStatus(): { domains: DomainStatus[]; embedModel?: string; dims?: number; totalCourses?: number } {
  const root = academicBrainDir()
  let coursesByField: Record<string, number> = {}
  let embedModel: string | undefined
  let dims: number | undefined
  let totalCourses: number | undefined
  try {
    const m = JSON.parse(fs.readFileSync(path.join(root, '_manifest.json'), 'utf8')) as {
      courses_by_field?: Record<string, number>; embed_model?: string; dims?: number; courses_built?: number
    }
    coursesByField = m.courses_by_field ?? {}
    embedModel = m.embed_model
    dims = m.dims
    totalCourses = m.courses_built
  } catch { /* no manifest yet */ }

  const domains: DomainStatus[] = EXPECTED_DOMAINS.map((field) => {
    const present = hasJsonl(path.join(root, field))
    const courses = coursesByField[field] ?? 0
    // missing: no field dir. thin: present but ≤2 courses (a smoke run, not the real corpus). rich: real.
    const status: DomainStatus['status'] = !present ? 'missing' : courses <= 2 ? 'thin' : 'rich'
    return { field, present, courses, status }
  })
  return { domains, embedModel, dims, totalCourses }
}
