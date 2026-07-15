import { NextResponse } from 'next/server'
import { computeGraphHealth, computeTimeService } from '@socioprophet/hellgraph'
import { getHellGraph } from '@socioprophet/hellgraph'

export const runtime = 'nodejs'

// Stubbed in the Tauri static export (output:export requires GET route handlers to opt into
// static generation). The desktop app calls agent-machine's own endpoint, never this Next route.
export const dynamic = 'force-static'

// Live HellGraph operational status — feeds the Operate surface.
export async function GET() {
  const g = getHellGraph()
  return NextResponse.json({
    graph: computeGraphHealth(),
    time: computeTimeService(),
    eventLedger: g.logTail(20),
  })
}
