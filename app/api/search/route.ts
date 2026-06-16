import { NextRequest, NextResponse } from 'next/server'
import { webSearch } from '@/lib/tools/webSearch'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { query?: string; provider_keys?: { serper?: string } }
    const query = body.query?.trim()
    if (!query) return NextResponse.json({ error: 'query_required' }, { status: 400 })
    const results = await webSearch(query, body.provider_keys?.serper)
    return NextResponse.json({ results })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'search_failed' }, { status: 500 })
  }
}
