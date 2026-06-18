import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

type EmbedRequest = {
  text?: string
  texts?: string[]
  openai_key?: string
}

const OLLAMA_BASE = process.env['OLLAMA_HOST'] ?? 'http://127.0.0.1:11435'
const LOCAL_EMBED_MODEL = process.env['NOETICA_EMBED_MODEL'] ?? 'nomic-embed-text'

// Local-first embeddings via Ollama — used when no OpenAI key is supplied so
// semantic memory search works fully offline (keyword fallback otherwise).
async function embedViaOllama(inputs: string[]): Promise<number[][] | null> {
  try {
    const res = await fetch(`${OLLAMA_BASE}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: LOCAL_EMBED_MODEL, input: inputs }),
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) return null
    const data = await res.json() as { embeddings?: number[][] }
    return data.embeddings ?? null
  } catch {
    return null
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json() as EmbedRequest
  const { text, texts, openai_key } = body
  const single = Boolean(text && !texts)

  const inputs: string[] = texts?.length ? texts : text ? [text] : []
  if (inputs.length === 0) {
    return NextResponse.json({ error: 'text or texts required' }, { status: 400 })
  }

  let embeddings: number[][] | null = null

  if (openai_key) {
    const res = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${openai_key}`,
      },
      body: JSON.stringify({ model: 'text-embedding-3-small', input: inputs, dimensions: 512 }),
    })
    if (res.ok) {
      const data = await res.json() as { data: { embedding: number[]; index: number }[] }
      embeddings = [...data.data].sort((a, b) => a.index - b.index).map((d) => d.embedding)
    }
    // If OpenAI fails (bad key, offline), fall through to the local model below.
  }

  if (!embeddings) {
    embeddings = await embedViaOllama(inputs)
  }

  if (!embeddings) {
    return NextResponse.json(
      { error: 'no embedding backend available (set an OpenAI key or run Ollama with the embed model)' },
      { status: 503 },
    )
  }

  if (single) {
    return NextResponse.json({ embedding: embeddings[0] })
  }
  return NextResponse.json({ embeddings })
}
