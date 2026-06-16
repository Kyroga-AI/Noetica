import { NextResponse } from 'next/server'
import { getHellGraph } from '@/lib/hellgraph/store'
import { getAtomSpace } from '@/lib/hellgraph/atomspace'
import { runSparql } from '@/lib/hellgraph/sparql'
import { runGremlin } from '@/lib/hellgraph/gremlin'
import { findMatches, type Pattern } from '@/lib/hellgraph/patternMatcher'

export const runtime = 'nodejs'

type QueryBody = {
  language?: 'sparql' | 'gremlin' | 'pattern'
  query?: string
  pattern?: Pattern
}

// HellGraph query endpoint — three coequal query surfaces over one metagraph:
//   • SPARQL 1.1 (subset)      — RDF triple view (Neptune/Blazegraph parity)
//   • Gremlin / TinkerPop      — property-graph traversal
//   • pattern                  — native hypergraph pattern matcher (AtomSpace)
export async function POST(request: Request) {
  const body = (await request.json()) as QueryBody
  const language = body.language ?? 'sparql'

  try {
    const started = Date.now()

    if (language === 'pattern') {
      if (!body.pattern?.clauses?.length) {
        return NextResponse.json({ error: 'pattern_required' }, { status: 400 })
      }
      const result = findMatches(getAtomSpace(), body.pattern)
      return NextResponse.json({ language, result, elapsed_ms: Date.now() - started })
    }

    const query = body.query?.trim()
    if (!query) return NextResponse.json({ error: 'query_required' }, { status: 400 })

    if (language === 'gremlin') {
      const result = runGremlin(getHellGraph(), query)
      return NextResponse.json({ language, result, elapsed_ms: Date.now() - started })
    }
    const result = runSparql(getHellGraph(), query)
    return NextResponse.json({ language, result, elapsed_ms: Date.now() - started })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'query_failed', language },
      { status: 400 }
    )
  }
}
