import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

type EmbedRequest = {
  text?: string
  texts?: string[]
  openai_key: string
}

export async function POST(req: NextRequest) {
  const body = await req.json() as EmbedRequest
  const { text, texts, openai_key } = body

  if (!openai_key) {
    return NextResponse.json({ error: 'openai_key required' }, { status: 400 })
  }

  const inputs: string[] = texts?.length ? texts : text ? [text] : []
  if (inputs.length === 0) {
    return NextResponse.json({ error: 'text or texts required' }, { status: 400 })
  }

  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${openai_key}`,
    },
    body: JSON.stringify({ model: 'text-embedding-3-small', input: inputs, dimensions: 512 }),
  })

  if (!res.ok) {
    const err = await res.text()
    return NextResponse.json({ error: err }, { status: res.status })
  }

  const data = await res.json() as { data: { embedding: number[]; index: number }[] }
  const sorted = [...data.data].sort((a, b) => a.index - b.index)
  const embeddings = sorted.map((d) => d.embedding)

  if (text && !texts) {
    return NextResponse.json({ embedding: embeddings[0] })
  }
  return NextResponse.json({ embeddings })
}
