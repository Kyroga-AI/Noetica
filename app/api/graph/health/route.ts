import { NextResponse } from 'next/server'
import { computeGraphHealth, computeTimeService } from '@socioprophet/hellgraph'
import { getHellGraph } from '@socioprophet/hellgraph'

export const runtime = 'nodejs'

// Live HellGraph operational status — feeds the Operate surface.
export async function GET() {
  const g = getHellGraph()
  return NextResponse.json({
    graph: computeGraphHealth(),
    time: computeTimeService(),
    eventLedger: g.logTail(20),
  })
}
