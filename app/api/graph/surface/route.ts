import { NextResponse } from 'next/server'
import { getHellGraph } from '@socioprophet/hellgraph'
import { selectSurface } from '@/agent-machine/lib/graph-surface'

export const runtime = 'nodejs'

/**
 * GET /api/graph/surface?view=all|domain|document|chat&limit=N&root=<id>
 * Web entry point. Selection logic is shared with the agent-machine backend route
 * (lib/graph-surface) so web and Tauri desktop return identical subgraphs.
 */
export async function GET(req: Request) {
  const url = new URL(req.url)
  try {
    const g = getHellGraph()
    const result = selectSurface(g.allNodes(), g.allEdges(), {
      view: url.searchParams.get('view') ?? 'all',
      limit: Number(url.searchParams.get('limit') ?? 34),
      root: url.searchParams.get('root') ?? '',
    })
    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json({ nodes: [], links: [], error: String(err) }, { status: 500 })
  }
}
