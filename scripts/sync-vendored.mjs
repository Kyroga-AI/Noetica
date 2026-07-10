#!/usr/bin/env node
/**
 * sync-vendored — pin/version/sync ALL vendored code from one manifest (vendor.manifest.json).
 *
 *   node scripts/sync-vendored.mjs --check   # verify every vendored copy matches its pin (CI / pre-push); exit 1 on drift
 *   node scripts/sync-vendored.mjs --write   # rewrite every vendored copy to its pinned ref (the build runs this)
 *
 * Generalizes the old sync-sourceos-contracts.mjs: any file vendored from a GitHub repo is listed under
 * `sourceFiles` with a pinned commit; git-pinned npm deps (installed via package.json) are recorded under
 * `npmGitDeps` for visibility; anything not yet pinned is under `unpinned` and reported as a warning so it
 * can't silently rot. To update a pin, bump its ref in the manifest.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const mode = process.argv[2] ?? '--check'
if (!['--check', '--write'].includes(mode)) {
  console.error('usage: node scripts/sync-vendored.mjs [--check|--write]')
  process.exit(2)
}

const manifest = JSON.parse(await readFile(path.join(ROOT, 'vendor.manifest.json'), 'utf8'))

async function fetchText(url) {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`fetch ${url}: ${r.status} ${r.statusText}`)
  return r.text()
}

function fill(tpl, e) {
  return tpl.replace(/\{repo\}/g, e.repo).replace(/\{ref\}/g, e.ref).replace(/\{sourcePath\}/g, e.sourcePath)
}

let stale = 0, synced = 0
for (const e of manifest.sourceFiles ?? []) {
  const url = `https://raw.githubusercontent.com/${e.repo}/${e.ref}/${e.sourcePath}`
  const target = path.join(ROOT, e.targetPath)
  let upstream
  try { upstream = await fetchText(url) } catch (err) { console.error(`✗ ${e.name}: ${err.message}`); stale++; continue }

  let body = upstream
  if (e.stripPrefixRegex) body = body.replace(new RegExp(e.stripPrefixRegex), '')
  const desired = (e.header ? fill(e.header, e) : '') + body

  if (mode === '--write') {
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, desired, 'utf8')
    console.log(`✓ synced ${e.name} → ${e.targetPath} @ ${e.ref.slice(0, 10)}`)
    synced++
  } else {
    let current = ''
    try { current = await readFile(target, 'utf8') } catch { /* missing */ }
    if (current !== desired) {
      console.error(`✗ STALE ${e.name}: ${e.targetPath} != ${e.repo}@${e.ref.slice(0, 10)} — run: npm run vendor:sync`)
      stale++
    } else {
      console.log(`✓ ${e.name} current @ ${e.ref.slice(0, 10)}`)
    }
  }
}

// npm git-deps: verify the installed version matches the manifest pin (the build's `npm install` does the sync).
for (const d of manifest.npmGitDeps ?? []) {
  try {
    const pkg = JSON.parse(await readFile(path.join(ROOT, 'node_modules', d.name, 'package.json'), 'utf8'))
    const want = String(d.pin).replace(/^v/, '')
    const ok = pkg.version === want
    console.log(`${ok ? '✓' : '⚠'} ${d.name} installed ${pkg.version} (pin ${d.pin})${ok ? '' : ' — run: npm install'}`)
    if (!ok && mode === '--check') stale++
  } catch { console.log(`⚠ ${d.name}: not installed — run: npm install`) }
}

for (const u of manifest.unpinned ?? []) console.warn(`… UNPINNED vendored: ${u.name} (${u.file}) — upstream ${u.upstream}; needs a ref to auto-sync`)

if (mode === '--check' && stale > 0) { console.error(`\n${stale} vendored dependency(ies) stale/unpinned-mismatch.`); process.exit(1) }
console.log(mode === '--write' ? `\nvendored sync complete (${synced} written).` : `\nvendored deps checked — all pinned copies current.`)
