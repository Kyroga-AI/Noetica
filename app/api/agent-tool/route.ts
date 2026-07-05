import { NextResponse } from 'next/server'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

export const runtime = 'nodejs'

// This route is reachable over local HTTP with an untrusted body, so a user-
// supplied absolute path or `..` escape would otherwise let it read/write ANY
// file on the machine (js/path-injection). Confine every tool path to the
// user's home tree and reject anything that resolves outside it.
const ROOT = fs.realpathSync(os.homedir())

function resolvePath(p: string): string {
  if (!p) return ''
  const requested = p.startsWith('~/') ? path.join(ROOT, p.slice(2)) : p
  const resolved = path.resolve(ROOT, requested)
  // Lexical containment barrier FIRST — before ANY filesystem access — so nothing
  // touches an unvalidated user path. A `path.relative(...)` that starts with '..'
  // (or is absolute) is the containment barrier CodeQL recognizes for js/path-injection.
  const rel = path.relative(ROOT, resolved)
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('path escapes the permitted root')
  }
  // `resolved` is now confined to ROOT. Symlink hardening: if it already exists,
  // resolve symlinks and re-check the real target is still inside ROOT (a symlink
  // inside ROOT could otherwise redirect the op outside it — a lexical resolve
  // misses that). New paths (e.g. a file being created) keep the validated value.
  let real = resolved
  if (fs.existsSync(resolved)) {
    const realResolved = fs.realpathSync(resolved)
    const realRel = path.relative(ROOT, realResolved)
    if (realRel.startsWith('..') || path.isAbsolute(realRel)) {
      throw new Error('path escapes the permitted root')
    }
    real = realResolved
  }
  return real
}

export async function POST(request: Request) {
  const body = (await request.json()) as { tool?: string; input?: Record<string, unknown> }
  const { tool, input = {} } = body

  try {
    if (tool === 'read_file') {
      const filePath = resolvePath((input.path as string | undefined) ?? '')
      if (!filePath) return NextResponse.json({ error: 'path is required' }, { status: 400 })
      if (!fs.existsSync(filePath)) return NextResponse.json({ error: `File not found: ${filePath}` }, { status: 404 })
      const stat = fs.statSync(filePath)
      if (stat.size > 2 * 1024 * 1024) return NextResponse.json({ error: `File too large (${stat.size} bytes). Max 2 MB.` }, { status: 413 })
      const content = fs.readFileSync(filePath, 'utf-8')
      return NextResponse.json({ result: content })
    }

    if (tool === 'write_file') {
      const filePath = resolvePath((input.path as string | undefined) ?? '')
      const content = (input.content as string | undefined) ?? ''
      if (!filePath) return NextResponse.json({ error: 'path is required' }, { status: 400 })
      fs.mkdirSync(path.dirname(filePath), { recursive: true })
      fs.writeFileSync(filePath, content, 'utf-8')
      return NextResponse.json({ result: `Written: ${filePath}` })
    }

    if (tool === 'list_directory') {
      const dirPath = resolvePath((input.path as string | undefined) ?? '')
      if (!dirPath) return NextResponse.json({ error: 'path is required' }, { status: 400 })
      if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
        return NextResponse.json({ error: `Not a directory: ${dirPath}` }, { status: 404 })
      }
      const entries = fs.readdirSync(dirPath).map((name) => {
        const full = path.join(dirPath, name)
        const stat = fs.statSync(full)
        return stat.isDirectory() ? `d  ${name}/` : `f  ${name}  (${stat.size} bytes)`
      })
      return NextResponse.json({ result: entries.length ? entries.join('\n') : '(empty directory)' })
    }

    return NextResponse.json({ error: `Unknown tool: ${tool}` }, { status: 400 })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
