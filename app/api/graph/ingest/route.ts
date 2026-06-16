import { NextResponse } from 'next/server'
import { ingestInteraction, type InteractionFact } from '@/lib/hellgraph/ingest'

export const runtime = 'nodejs'

// Ingest a single governed interaction into HellGraph. Called by the chat route
// after a successful provider run so the graph populates from live activity.
export async function POST(request: Request) {
  const fact = (await request.json()) as Partial<InteractionFact>
  if (!fact.runId || !fact.sessionId) {
    return NextResponse.json({ error: 'runId_and_sessionId_required' }, { status: 400 })
  }
  try {
    ingestInteraction({
      runId: fact.runId,
      sessionId: fact.sessionId,
      modelRouted: fact.modelRouted ?? 'unknown',
      provider: fact.provider ?? 'unknown',
      promptSummary: fact.promptSummary ?? '',
      responseSummary: fact.responseSummary ?? '',
      evidenceHash: fact.evidenceHash ?? 'none',
      policyAdmitted: fact.policyAdmitted ?? true,
      steeringFeatureId: fact.steeringFeatureId,
      latencyMs: fact.latencyMs ?? 0,
      timestamp: fact.timestamp ?? new Date().toISOString(),
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'ingest_failed' }, { status: 500 })
  }
}
