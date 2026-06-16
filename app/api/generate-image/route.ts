import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { prompt?: string; provider_keys?: { openai?: string } }
    const prompt = body.prompt?.trim()
    if (!prompt) return NextResponse.json({ error: 'prompt_required' }, { status: 400 })

    const apiKey = body.provider_keys?.openai?.trim() || process.env.OPENAI_API_KEY
    if (!apiKey) return NextResponse.json({ error: 'openai_key_required' }, { status: 400 })

    const res = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: 'dall-e-3', prompt, n: 1, size: '1024x1024', response_format: 'url' }),
    })

    if (!res.ok) {
      const err = await res.text()
      throw new Error(`OpenAI images API ${res.status}: ${err}`)
    }

    const data = await res.json() as { data?: Array<{ url?: string; revised_prompt?: string }> }
    const image = data.data?.[0]
    if (!image?.url) throw new Error('No image URL in response')

    return NextResponse.json({ url: image.url, revised_prompt: image.revised_prompt })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'generation_failed' }, { status: 502 })
  }
}
