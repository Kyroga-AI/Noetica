#!/usr/bin/env node
/**
 * Engine version-sync guard.
 *
 * The @socioprophet/hellgraph engine is pinned in multiple manifests (Noetica root +
 * agent-machine, and — out of tree — prophet-platform's hellgraph-service). If they
 * drift, the app and the service run different graph semantics and the compounding
 * loop silently diverges.
 *
 * ── Why the FLOOR was added (2026-07) ────────────────────────────────────────────────
 * A stale engine shipped to production (a 0.4.6 fork) while main advanced to 0.4.21 and
 * nobody noticed — the pins AGREED with each other, they were just all old. Consistency
 * alone doesn't catch "everyone is equally behind." So this now also enforces a FLOOR:
 * the pinned version must be >= MIN_ENGINE, bumped on every engine release (keep in
 * lockstep with prophet-platform/apps/hellgraph-service).
 *
 * Checks: (1) every in-tree pin agrees, (2) the agreed version is >= MIN_ENGINE.
 * Exit 0 = all good; exit 1 = drift or below floor (prints the offenders).
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// ── the estate's floor: the OLDEST engine allowed. Bump on every release. ──
const MIN_ENGINE = 'v0.4.22'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const DEP = '@socioprophet/hellgraph'
const manifests = ['package.json', 'agent-machine/package.json']
const norm = (v) => v.replace(/^v/, '').split('.').map(Number)
const cmp = (a, b) => { const pa = norm(a), pb = norm(b); for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0); return 0 }

const pins = []
for (const rel of manifests) {
  let pkg
  try { pkg = JSON.parse(readFileSync(join(root, rel), 'utf8')) } catch { continue }
  const spec = pkg.dependencies?.[DEP] ?? pkg.devDependencies?.[DEP]
  if (!spec) continue
  const m = spec.match(/#(v?[\d.]+)/)
  pins.push({ rel, spec, version: m ? m[1] : '(unpinned)' })
}

if (pins.length === 0) { console.error(`✗ no ${DEP} pin found in any manifest`); process.exit(1) }

const versions = new Set(pins.map((p) => p.version))
for (const p of pins) console.log(`  ${p.rel.padEnd(28)} ${p.version}`)

if (versions.size > 1) {
  console.error(`\n✗ engine version drift: ${[...versions].join(' vs ')}`)
  console.error(`  align every manifest (and prophet-platform/apps/hellgraph-service) to one tag.`)
  process.exit(1)
}
const version = [...versions][0]
if (version === '(unpinned)' || cmp(version, MIN_ENGINE) < 0) {
  console.error(`\n✗ engine ${version} is BELOW the floor ${MIN_ENGINE} — bump the pin to a current release.`)
  console.error(`  (consistency alone won't save you: this is exactly the stale-engine regression the floor exists to stop.)`)
  process.exit(1)
}
console.log(`\n✓ ${DEP} pinned consistently at ${version} across ${pins.length} manifest(s); floor ${MIN_ENGINE} satisfied`)
