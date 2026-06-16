import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

type SearchResult = { title: string; url: string; snippet: string }

async function serperSearch(query: string, apiKey: string): Promise<SearchResult[]> {
  const res = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-API-KEY': apiKey },
    body: JSON.stringify({ q: query, num: 5 }),
  })
  if (!res.ok) throw new Error(`Serper ${res.status}`)
  const data = await res.json() as { organic?: Array<{ title?: string; link?: string; snippet?: string }> }
  return (data.organic ?? []).slice(0, 5).map((r) => ({
    title: r.title ?? '',
    url: r.link ?? '',
    snippet: r.snippet ?? '',
  }))
}

async function ddgSearch(query: string): Promise<SearchResult[]> {
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`
  const res = await fetch(url, { headers: { 'User-Agent': 'Noetica/1.0' } })
  if (!res.ok) throw new Error(`DuckDuckGo ${res.status}`)
  const data = await res.json() as {
    RelatedTopics?: Array<{ FirstURL?: string; Text?: string; Topics?: unknown[] }>
    AbstractURL?: string
    AbstractText?: string
    Heading?: string
  }

  const results: SearchResult[] = []

  // Include abstract if available
  if (data.AbstractText && data.AbstractURL) {
    results.push({ title: data.Heading ?? query, url: data.AbstractURL, snippet: data.AbstractText })
  }

  for (const topic of data.RelatedTopics ?? []) {
    if (results.length >= 5) break
    if (!topic.FirstURL || !topic.Text || topic.Topics) continue
    results.push({
      title: topic.Text.split(' - ')[0] ?? topic.Text,
      url: topic.FirstURL,
      snippet: topic.Text,
    })
  }

  return results
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { query?: string; provider_keys?: { serper?: string } }
    const query = body.query?.trim()
    if (!query) return NextResponse.json({ error: 'query_required' }, { status: 400 })

    const serperKey = body.provider_keys?.serper?.trim()
    const results = serperKey
      ? await serperSearch(query, serperKey)
      : await ddgSearch(query)

    return NextResponse.json({ results })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'search_failed' }, { status: 500 })
  }
}
