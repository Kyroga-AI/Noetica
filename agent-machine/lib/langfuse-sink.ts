/**
 * langfuse-sink — optional eval-tracing side-channel.
 *
 * Langfuse (https://langfuse.com) captures LLM traces, evals, and cost data.
 * When LANGFUSE_SECRET_KEY + LANGFUSE_PUBLIC_KEY are set, every captured failure
 * or feedback event is shipped as a Langfuse Score so the learning loop is
 * observable from the Langfuse dashboard without any SDK dependency.
 *
 * All calls are fire-and-forget: a failed flush never throws and never blocks a turn.
 */

const BASE_URL = process.env['LANGFUSE_BASE_URL'] ?? 'https://cloud.langfuse.com'
const SECRET_KEY = process.env['LANGFUSE_SECRET_KEY'] ?? ''
const PUBLIC_KEY = process.env['LANGFUSE_PUBLIC_KEY'] ?? ''

function enabled(): boolean {
  return SECRET_KEY.length > 0 && PUBLIC_KEY.length > 0
}

function authHeader(): string {
  return 'Basic ' + Buffer.from(`${PUBLIC_KEY}:${SECRET_KEY}`).toString('base64')
}

export interface LangfuseTrace {
  traceId: string
  input: string
  output: string
  model: string
  score: number          // 0–1
  label: string          // e.g. "ungrounded" | "thin-coverage" | "procedural-success"
  comment?: string
  tags?: string[]
  latencyMs?: number
}

/**
 * Fire-and-forget: post a trace + score to Langfuse if configured.
 * Safe to call unconditionally — returns immediately when not configured.
 */
export function maybeSinkToLangfuse(trace: LangfuseTrace): void {
  if (!enabled()) return
  void flush(trace)
}

const MAX_FIELD_CHARS = 4000

function truncate(s: string): string {
  return s.length > MAX_FIELD_CHARS ? s.slice(0, MAX_FIELD_CHARS) + ' …[truncated]' : s
}

async function flush(trace: LangfuseTrace): Promise<void> {
  try {
    // Upsert trace — truncate input/output to avoid shipping full user content to cloud.
    const r = await fetch(`${BASE_URL}/api/public/traces`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authHeader() },
      body: JSON.stringify({
        id: trace.traceId,
        name: trace.label,
        input: truncate(trace.input),
        output: truncate(trace.output),
        metadata: { model: trace.model, latencyMs: trace.latencyMs ?? null },
        tags: trace.tags ?? [],
      }),
      signal: AbortSignal.timeout(8000),
    })

    // Only post the score if the trace was accepted — an orphaned score is noise.
    if (!r.ok) return

    await fetch(`${BASE_URL}/api/public/scores`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authHeader() },
      body: JSON.stringify({
        traceId: trace.traceId,
        name: trace.label,
        value: trace.score,
        comment: trace.comment ?? null,
        dataType: 'NUMERIC',
      }),
      signal: AbortSignal.timeout(8000),
    })
  } catch {
    // Never throw — observability must not block the hot path.
  }
}
