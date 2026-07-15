import { NextResponse, type NextRequest } from 'next/server'
import { saeActivate, saeHealth } from '@/lib/sae/saeClient'

export const runtime = 'nodejs'
export const dynamic = 'force-static'

// GET /api/sae/explore?prompt=...&top_k=20  — top activating features for a prompt
// GET /api/sae/explore                       — sidecar health + model info

export async function GET(request: NextRequest) {
  // In the Tauri static export these routes are unused (app/layout.tsx rewrites /api/* to the
  // agent-machine sidecar); return a stub at export time so no request is read during prerender.
  if (process.env.NOETICA_STATIC_EXPORT === '1') return NextResponse.json({ error: 'static_export_stub' }, { status: 501 })
  const prompt = new URL(request.url).searchParams.get('prompt')
  const topK = parseInt(new URL(request.url).searchParams.get('top_k') ?? '20', 10)

  if (!prompt) {
    const health = await saeHealth()
    if (!health) return NextResponse.json({ error: 'sae_sidecar_unavailable' }, { status: 503 })
    return NextResponse.json(health)
  }

  const result = await saeActivate(prompt.trim(), topK)
  if (!result) {
    return NextResponse.json({ error: 'sae_sidecar_unavailable', hint: 'Start sae_patch.py on port 8138' }, { status: 503 })
  }
  return NextResponse.json(result)
}
