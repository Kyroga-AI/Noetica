import { NextResponse } from 'next/server'
import { sidecarHealth, syncToSidecar, runBindLink, plnForwardChain, ecanStimulate } from '@socioprophet/hellgraph'

export const runtime = 'nodejs'

type ReasonBody = {
  op: 'health' | 'sync' | 'pattern' | 'pln' | 'ecan'
  bindlink?: string
  iterations?: number
  focus?: string
  atom?: string
  sti?: number
}

// HellGraph reasoning endpoint — delegates to the OpenCog sidecar (real PLN /
// ECAN / Pattern Matcher). Returns sidecar availability so the UI can surface
// whether deep reasoning is online.
export async function POST(request: Request) {
  const body = (await request.json()) as ReasonBody

  try {
    switch (body.op) {
      case 'health':
        return NextResponse.json({ sidecar: await sidecarHealth() })
      case 'sync':
        return NextResponse.json(await syncToSidecar())
      case 'pattern':
        if (!body.bindlink) return NextResponse.json({ error: 'bindlink_required' }, { status: 400 })
        return NextResponse.json(await runBindLink(body.bindlink))
      case 'pln':
        return NextResponse.json(await plnForwardChain(body.iterations ?? 10, body.focus))
      case 'ecan':
        if (!body.atom) return NextResponse.json({ error: 'atom_required' }, { status: 400 })
        return NextResponse.json(await ecanStimulate(body.atom, body.sti ?? 100))
      default:
        return NextResponse.json({ error: 'unknown_op' }, { status: 400 })
    }
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'reason_failed', sidecar_offline: true },
      { status: 502 }
    )
  }
}
