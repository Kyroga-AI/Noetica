import { NextResponse, type NextRequest } from 'next/server'
import { listFeatures, searchFeatures } from '@/lib/sae/features'

export const runtime = 'nodejs'
export const dynamic = 'force-static'

// GET /api/features?model=gpt2-small&q=sycophancy
export async function GET(request: NextRequest) {
  // In the Tauri static export these routes are unused (app/layout.tsx rewrites /api/* to the
  // agent-machine sidecar); return a stub at export time so no request is read during prerender.
  if (process.env.NOETICA_STATIC_EXPORT === '1') return NextResponse.json({ error: 'static_export_stub' }, { status: 501 })
  const modelId = new URL(request.url).searchParams.get('model') ?? undefined
  const query = new URL(request.url).searchParams.get('q') ?? ''

  const features = query.trim()
    ? searchFeatures(query.trim(), modelId)
    : listFeatures(modelId)

  return NextResponse.json({ features, total: features.length, source: 'local-sae-registry' })
}
