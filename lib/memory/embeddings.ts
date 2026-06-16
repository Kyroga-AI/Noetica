export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0
  let dot = 0, normA = 0, normB = 0
  for (let i = 0; i < a.length; i++) {
    dot   += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  return denom === 0 ? 0 : dot / denom
}

function tokenize(text: string): Set<string> {
  return new Set(
    text.toLowerCase().split(/\W+/).filter((w) => w.length > 2)
  )
}

// TF-IDF-style keyword scoring — no API needed
export function keywordScore(query: string, text: string): number {
  const qTokens = tokenize(query)
  if (qTokens.size === 0) return 0
  const tTokens = tokenize(text)
  let matches = 0
  for (const t of qTokens) {
    if (tTokens.has(t)) matches++
  }
  return matches / qTokens.size
}

// Fetch embedding(s) from the Noetica embed API route
export async function fetchEmbedding(text: string, openaiKey: string): Promise<number[] | null> {
  try {
    const res = await fetch('/api/embed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, openai_key: openaiKey }),
    })
    if (!res.ok) return null
    const data = await res.json() as { embedding: number[] }
    return data.embedding ?? null
  } catch {
    return null
  }
}

export async function fetchEmbeddings(texts: string[], openaiKey: string): Promise<number[][] | null> {
  if (texts.length === 0) return []
  try {
    const res = await fetch('/api/embed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ texts, openai_key: openaiKey }),
    })
    if (!res.ok) return null
    const data = await res.json() as { embeddings: number[][] }
    return data.embeddings ?? null
  } catch {
    return null
  }
}
