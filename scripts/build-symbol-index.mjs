#!/usr/bin/env node
/**
 * build-symbol-index — generate a SYMBOL-level map of our own codebase (exported functions/classes/types/consts
 * + Rust items), so the coding agent can locate a definition by name instead of grepping blind. Writes
 * agent-machine/canon/symbol-index.json (committed + shipped); the binary has no source at runtime, so this MUST
 * run at build time (deploy.sh / CI). Complements build-stack-index (module level) with definition-site detail.
 */
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const DIRS = ['agent-machine/lib', 'agent-machine', 'lib', 'components', 'src-tauri/src']
const EXT = /\.(ts|tsx|rs)$/
const SKIP = /(node_modules|\.test\.|\.next|target|dist|out|__pycache__|canon\/)/

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

// Definition patterns → kind. Anchored to the start of a (trimmed) line so we catch declarations, not uses.
const TS_PATTERNS = [
  [/^export\s+(?:async\s+)?function\s+([A-Za-z0-9_]+)/, 'function'],
  [/^export\s+default\s+(?:async\s+)?function\s+([A-Za-z0-9_]+)/, 'function'],
  [/^export\s+(?:abstract\s+)?class\s+([A-Za-z0-9_]+)/, 'class'],
  [/^export\s+interface\s+([A-Za-z0-9_]+)/, 'interface'],
  [/^export\s+type\s+([A-Za-z0-9_]+)/, 'type'],
  [/^export\s+enum\s+([A-Za-z0-9_]+)/, 'enum'],
  [/^export\s+const\s+([A-Za-z0-9_]+)/, 'const'],
]
const RS_PATTERNS = [
  [/^pub\s+(?:async\s+)?(?:unsafe\s+)?fn\s+([A-Za-z0-9_]+)/, 'fn'],
  [/^(?:async\s+)?fn\s+([A-Za-z0-9_]+)/, 'fn'],            // tauri commands etc.
  [/^pub\s+struct\s+([A-Za-z0-9_]+)/, 'struct'],
  [/^pub\s+enum\s+([A-Za-z0-9_]+)/, 'enum'],
  [/^pub\s+trait\s+([A-Za-z0-9_]+)/, 'trait'],
]

const files = []
for (const d of DIRS) walk(path.join(ROOT, d), files)

const symbols = []
const seen = new Set()
for (const file of files) {
  const rel = path.relative(ROOT, file)
  const lang = file.endsWith('.rs') ? 'rs' : 'ts'
  const patterns = lang === 'rs' ? RS_PATTERNS : TS_PATTERNS
  let lines
  try { lines = fs.readFileSync(file, 'utf8').split('\n') } catch { continue }
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim()
    for (const [re, kind] of patterns) {
      const m = trimmed.match(re)
      if (m) {
        const key = `${rel}:${m[1]}:${kind}`
        if (seen.has(key)) break
        seen.add(key)
        symbols.push({ name: m[1], kind, rel, line: i + 1, lang })
        break
      }
    }
  }
}

symbols.sort((a, b) => a.name.localeCompare(b.name))
const out = { generatedAt: null, count: symbols.length, symbols }   // generatedAt stamped by the caller if needed
const dest = path.join(ROOT, 'agent-machine/canon/symbol-index.json')
fs.mkdirSync(path.dirname(dest), { recursive: true })
fs.writeFileSync(dest, JSON.stringify(out))
console.log(`build-symbol-index: ${symbols.length} symbols across ${files.length} files → ${path.relative(ROOT, dest)}`)
