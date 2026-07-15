import { NextResponse } from 'next/server'
import { getHellGraph } from '@socioprophet/hellgraph'
import { selectSurface } from '@/agent-machine/lib/graph-surface'

export const runtime = 'nodejs'
// Let the static export (Tauri desktop) prerender this to a stub — the desktop app calls
// the agent-machine's own /api/graph/surface, never this one, so it's unused in the export.
// Without this, `new URL(req.url)` makes the static build fail to prerender the route.
export const dynamic = 'force-static'

/**
 * GET /api/graph/surface?view=all|domain|document|chat&limit=N&root=<id>
 * Web entry point. Selection logic is shared with the agent-machine backend route
 * (lib/graph-surface) so web and Tauri desktop return identical subgraphs.
 */
export async function GET(req: Request) {
  // In the Tauri static export these routes are unused (app/layout.tsx rewrites /api/* to the
  // agent-machine sidecar); return a stub at export time so no request is read during prerender.
  if (process.env.NOETICA_STATIC_EXPORT === '1') return NextResponse.json({ error: 'static_export_stub' }, { status: 501 })
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
