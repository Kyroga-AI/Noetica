import { NextResponse, type NextRequest } from 'next/server'
import { listFeatures, searchFeatures } from '@/lib/sae/features'

export const runtime = 'nodejs'
export const dynamic = 'force-static'

// GET /api/features?model=gpt2-small&q=sycophancy
export async function GET(request: NextRequest) {
  const modelId = request.nextUrl.searchParams.get('model') ?? undefined
  const query = request.nextUrl.searchParams.get('q') ?? ''

  const features = query.trim()
    ? searchFeatures(query.trim(), modelId)
    : listFeatures(modelId)

  return NextResponse.json({ features, total: features.length, source: 'local-sae-registry' })
}
