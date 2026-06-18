#!/usr/bin/env node
/**
 * Engine version-sync guard.
 *
 * The @socioprophet/hellgraph engine is pinned in multiple manifests (Noetica
 * root + agent-machine, and — out of tree — prophet-platform's hellgraph-service).
 * If they drift, the app and the service run different graph semantics and the
 * compounding loop silently diverges. This asserts every in-tree pin agrees.
 *
 * Exit 0 = all pins match; exit 1 = drift detected (prints the offenders).
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const DEP = '@socioprophet/hellgraph'
const manifests = ['package.json', 'agent-machine/package.json']

const pins = []
for (const rel of manifests) {
  let pkg
  try { pkg = JSON.parse(readFileSync(join(root, rel), 'utf8')) } catch { continue }
  const spec = pkg.dependencies?.[DEP] ?? pkg.devDependencies?.[DEP]
  if (!spec) continue
  const m = spec.match(/#(v?[\d.]+)/)
  pins.push({ rel, spec, version: m ? m[1] : '(unpinned)' })
}

if (pins.length === 0) {
  console.error(`✗ no ${DEP} pin found in any manifest`)
  process.exit(1)
}

const versions = new Set(pins.map((p) => p.version))
for (const p of pins) console.log(`  ${p.rel.padEnd(28)} ${p.version}`)

if (versions.size > 1) {
  console.error(`\n✗ engine version drift: ${[...versions].join(' vs ')}`)
  console.error(`  align every manifest (and prophet-platform/apps/hellgraph-service) to one tag.`)
  process.exit(1)
}
console.log(`\n✓ ${DEP} pinned consistently at ${[...versions][0]} across ${pins.length} manifest(s)`)
