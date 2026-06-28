#!/usr/bin/env node
/**
 * build-stack-index — generate a module-level map of OUR OWN codebase (the "stack") so the graph's Tech lens
 * shows the real architecture, not doc-derived concepts. Writes agent-machine/canon/stack-index.json (committed
 * + shipped); the agent-machine ingests it on boot into CodeModule atoms + IMPORTS edges. The compiled binary
 * has no source at runtime, so this MUST run at build time (deploy.sh / CI), not from cwd in prod.
 *
 * Module-level (not symbol-level): nodes = source modules, edges = local imports. Enough to render the stack.
 */
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const DIRS = ['agent-machine/lib', 'agent-machine', 'lib', 'components', 'src-tauri/src']
const EXT = /\.(ts|tsx|rs)$/
const SKIP = /(node_modules|\.test\.|\.next|target|dist|out|__pycache__)/

function walk(dir, acc) {
  let entries
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return acc }
  for (const e of entries) {
    const p = path.join(dir, e.name)
    if (SKIP.test(p)) continue
    if (e.isDirectory()) walk(p, acc)
    else if (EXT.test(e.name)) acc.push(p)
  }
  return acc
}

// Collect files (agent-machine non-recursive for the top level to avoid re-walking lib).
const files = []
for (const d of DIRS) {
  const abs = path.join(ROOT, d)
  if (d === 'agent-machine') {
    // just server.ts + top-level .ts at this level (lib handled separately)
    try { for (const e of fs.readdirSync(abs, { withFileTypes: true })) { if (e.isFile() && EXT.test(e.name)) files.push(path.join(abs, e.name)) } } catch { /* */ }
  } else walk(abs, files)
}

const rel = (p) => path.relative(ROOT, p).replace(/\\/g, '/')
const modId = (p) => `urn:noetica:code:${rel(p).replace(/[^a-zA-Z0-9]+/g, '-')}`
const known = new Map(files.map((f) => [rel(f), f]))

const modules = []
const imports = []
for (const f of files) {
  const r = rel(f)
  const name = path.basename(f).replace(EXT, '')
  const kind = r.startsWith('components/') ? 'component' : r.startsWith('src-tauri/') ? 'rust' : r.includes('/lib/') || r.startsWith('lib/') ? 'lib' : 'module'
  modules.push({ id: modId(f), rel: r, name, kind })
  let src = ''
  try { src = fs.readFileSync(f, 'utf8') } catch { /* */ }
  // Local imports only (relative paths or @/ alias) — external deps aren't part of "our stack".
  for (const m of src.matchAll(/(?:import|from)\s+['"]((?:\.{1,2}\/|@\/)[^'"]+)['"]/g)) {
    let spec = m[1]
    if (spec.startsWith('@/')) spec = spec.slice(2)                       // @/ alias → repo root
    let target = spec.startsWith('.') ? path.normalize(path.join(path.dirname(r), spec)) : spec
    target = target.replace(/\\/g, '/').replace(/\.js$/, '')
    // resolve to a known module file (.ts/.tsx or /index)
    const cand = [`${target}.ts`, `${target}.tsx`, `${target}/index.ts`, `${target}/index.tsx`].find((c) => known.has(c))
    if (cand) imports.push({ from: modId(f), to: modId(known.get(cand)) })
  }
}

const out = { generatedAt: null, modules, imports, counts: { modules: modules.length, imports: imports.length } }
const dest = path.join(ROOT, 'agent-machine/canon/stack-index.json')
fs.mkdirSync(path.dirname(dest), { recursive: true })
fs.writeFileSync(dest, JSON.stringify(out))
console.log(`[stack-index] ${modules.length} modules, ${imports.length} imports → ${rel(dest)}`)
