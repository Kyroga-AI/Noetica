import { NextRequest, NextResponse } from 'next/server'
import { generateImage } from '@/lib/tools/generateImage'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { prompt?: string; provider_keys?: { openai?: string } }
    const prompt = body.prompt?.trim()
    if (!prompt) return NextResponse.json({ error: 'prompt_required' }, { status: 400 })

    const apiKey = (body.provider_keys?.openai?.trim() || process.env.OPENAI_API_KEY)?.trim()
    if (!apiKey) return NextResponse.json({ error: 'openai_key_required' }, { status: 400 })

    const result = await generateImage(prompt, apiKey)
    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'generation_failed' }, { status: 502 })
  }
}
