import { NextResponse } from 'next/server'
import { getAtomSpace } from '@socioprophet/hellgraph'
import { dumpAtomese, parseAtomese } from '@socioprophet/hellgraph'

export const runtime = 'nodejs'

// Stubbed in the Tauri static export (output:export requires GET route handlers to opt into
// static generation). The desktop app calls agent-machine's own endpoint, never this Next route.
export const dynamic = 'force-static'

// GET  → export the entire metagraph as Atomese s-expressions (OpenCog-compatible).
export async function GET() {
  const as = getAtomSpace()
  return new NextResponse(dumpAtomese(as), {
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  })
}

// POST { atomese } → import OpenCog Atomese into the metagraph; returns root handles.
export async function POST(request: Request) {
  const body = (await request.json()) as { atomese?: string }
  if (!body.atomese?.trim()) {
    return NextResponse.json({ error: 'atomese_required' }, { status: 400 })
  }
  try {
    const handles = parseAtomese(getAtomSpace(), body.atomese)
    return NextResponse.json({ ok: true, imported: handles.length, handles })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'parse_failed' }, { status: 400 })
  }
}
