import { NextResponse, type NextRequest } from 'next/server'
import { saeActivate, saeHealth } from '@/lib/sae/saeClient'

export const runtime = 'nodejs'
export const dynamic = 'force-static'

// GET /api/sae/explore?prompt=...&top_k=20  — top activating features for a prompt
// GET /api/sae/explore                       — sidecar health + model info

export async function GET(request: NextRequest) {
  const prompt = request.nextUrl.searchParams.get('prompt')
  const topK = parseInt(request.nextUrl.searchParams.get('top_k') ?? '20', 10)

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
