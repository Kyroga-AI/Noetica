/**
 * academic-graph — project the provisioned MIT/academic brain (~/.noetica/brains/academic) into HellGraph as
 * AcademicField + AcademicCourse atoms, so the graph's Knowledge lens shows real academic structure (8 fields →
 * 347 courses) instead of being empty. Reads the user's brain dir at runtime (works in dev + prod when the brain
 * is provisioned; a no-op when it isn't). Module-level (fields + courses), not per-chunk — enough to render.
 * Idempotent.
 */
import { getHellGraph } from '@socioprophet/hellgraph'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const ACADEMIC_DIR = path.join(os.homedir(), '.noetica', 'brains', 'academic')

const titleCase = (s: string): string => s.replace(/\b\w/g, (c) => c.toUpperCase())

/** "6-006-introduction-to-algorithms-fall-2011.jsonl" → "Introduction To Algorithms". */
function courseTitle(file: string): string {
  return file
    .replace(/\.jsonl$/i, '')
    .replace(/^[0-9][0-9a-z.]*-/i, '')                              // strip leading course number (6-006-)
    .replace(/-(fall|spring|summer|winter|iap)-\d{4}.*$/i, '')      // strip term/year tail
    .replace(/-/g, ' ').replace(/\s+/g, ' ').trim()
    .slice(0, 60)
}

export function projectAcademicBrain(): { fields: number; courses: number } {
  if (!fs.existsSync(ACADEMIC_DIR)) return { fields: 0, courses: 0 }
  const g = getHellGraph()
  if (g.nodesByLabel('AcademicCourse').length > 0) return { fields: 0, courses: 0 }   // already projected
  let dirs: string[] = []
  try { dirs = fs.readdirSync(ACADEMIC_DIR, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name) } catch { return { fields: 0, courses: 0 } }
  const now = new Date().toISOString()
  let fields = 0, courses = 0
  for (const field of dirs) {
    const fieldId = `urn:noetica:academic:field:${field}`
    const fieldName = titleCase(field.replace(/_/g, ' '))
    try { g.addNode(fieldId, ['AcademicField'], { name: fieldName, surface: fieldName, created_at: now }); fields++ } catch { continue }
    let files: string[] = []
    try { files = fs.readdirSync(path.join(ACADEMIC_DIR, field)).filter((f) => f.endsWith('.jsonl')) } catch { /* */ }
    for (const f of files) {
      const title = courseTitle(f); if (title.length < 3) continue
      const cid = `urn:noetica:academic:course:${field}:${f.replace(/[^a-z0-9]+/gi, '-')}`
      try { g.addNode(cid, ['AcademicCourse'], { name: titleCase(title), surface: titleCase(title), field, created_at: now }); courses++ } catch { continue }
      try { g.addEdge('HAS_COURSE', fieldId, cid, { kind: 'academic' }) } catch { /* */ }
    }
  }
  return { fields, courses }
}
