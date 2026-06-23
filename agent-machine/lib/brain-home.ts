/**
 * brain-home — the ONE place that resolves where each shippable brain lives on disk.
 *
 * The academic (OCW) and operations (manpages) brains were read from ad-hoc per-module defaults
 * (~/Downloads/MIT OCW/_brain, ~/.noetica/ops-corpus) — fine for the developer's box, useless for a
 * fresh install. This centralizes the paths under a canonical brain-home (~/.noetica/brains) that the
 * provisioner installs into and the retrieval lanes read from, while still honoring the legacy paths and
 * explicit env overrides so existing setups keep working. (The chat brain is the HellGraph atomspace —
 * separate, personal, never provisioned; see brain-scope.ts.)
 */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

/** The root that provisioned brains install under. Overridable with NOETICA_BRAIN_HOME. */
export function brainHome(): string {
  return process.env['NOETICA_BRAIN_HOME'] || path.join(os.homedir(), '.noetica', 'brains')
}

// env override > first existing candidate > the canonical default (the provision target, even if absent).
function pick(envVar: string, candidates: string[]): string {
  const env = process.env[envVar]?.trim()
  if (env) return env
  for (const c of candidates) { try { if (fs.existsSync(c)) return c } catch { /* ignore */ } }
  return candidates[0]!
}

/** Academic (MIT-OCW STEM) brain directory. OCW_BRAIN > ~/.noetica/brains/academic > legacy ~/Downloads. */
export function academicBrainDir(): string {
  return pick('OCW_BRAIN', [path.join(brainHome(), 'academic'), path.join(os.homedir(), 'Downloads', 'MIT OCW', '_brain')])
}

/** Operations brain corpus file. OPS_CORPUS > ~/.noetica/brains/operational/manpages.jsonl > legacy. */
export function opsBrainFile(): string {
  return pick('OPS_CORPUS', [path.join(brainHome(), 'operational', 'manpages.jsonl'), path.join(os.homedir(), '.noetica', 'ops-corpus', 'manpages.jsonl')])
}
