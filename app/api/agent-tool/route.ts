import { NextResponse } from 'next/server'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

export const runtime = 'nodejs'

function resolvePath(p: string): string {
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2))
  return path.resolve(p)
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
