import { NextResponse } from 'next/server'

export const runtime = 'nodejs'

// Stubbed in the Tauri static export (output:export requires GET route handlers to opt into
// static generation). The desktop app calls agent-machine's own endpoint, never this Next route.
export const dynamic = 'force-static'

const DISTILL_URL = process.env.DISTILL_URL ?? 'http://127.0.0.1:8139'

async function proxyGet(path: string) {
  try {
    const res = await fetch(`${DISTILL_URL}${path}`, { signal: AbortSignal.timeout(10_000) })
    const json = await res.json()
    return NextResponse.json(json, { status: res.status })
  } catch {
    return NextResponse.json({ error: 'distill_server_unavailable' }, { status: 503 })
  }
}

async function proxyPost(path: string, payload: unknown) {
  try {
    const res = await fetch(`${DISTILL_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30_000),
    })
    const json = await res.json()
    return NextResponse.json(json, { status: res.status })
  } catch {
    return NextResponse.json({ error: 'distill_server_unavailable' }, { status: 503 })
  }
}

async function proxyDelete(path: string) {
  try {
    const res = await fetch(`${DISTILL_URL}${path}`, {
      method: 'DELETE',
      signal: AbortSignal.timeout(10_000),
    })
    const json = await res.json()
    return NextResponse.json(json, { status: res.status })
  } catch {
    return NextResponse.json({ error: 'distill_server_unavailable' }, { status: 503 })
  }
}

type DistillPostBody =
  | { op: 'pairs'; pairs: unknown[] }
  | { op: 'train'; student_model_id: string; teacher_type?: string; lora_r?: number; lora_alpha?: number; learning_rate?: number; max_steps?: number; kd_alpha?: number; kd_temperature?: number; kd_topk?: number; kd_adaptive_T?: boolean }
  | { op: 'cancel'; job_id: string }
  | { op: 'clear_pairs' }
  | { op: 'export' }

export async function GET(request: Request) {
  // In the Tauri static export these routes are unused (app/layout.tsx rewrites /api/* to the
  // agent-machine sidecar); return a stub at export time so no request is read during prerender.
  if (process.env.NOETICA_STATIC_EXPORT === '1') return NextResponse.json({ error: 'static_export_stub' }, { status: 501 })
  const { searchParams } = new URL(request.url)
  const jobId = searchParams.get('job_id')
  if (jobId) {
    return proxyGet(`/distill/status?job_id=${encodeURIComponent(jobId)}`)
  }
  return proxyGet('/distill/health')
}

export async function POST(request: Request) {
  const body = (await request.json()) as DistillPostBody

  switch (body.op) {
    case 'pairs':
      return proxyPost('/distill/pairs', { pairs: body.pairs })

    case 'train': {
      const { op: _op, ...trainConfig } = body
      return proxyPost('/distill/train', trainConfig)
    }

    case 'cancel':
      return proxyDelete(`/distill/job/${encodeURIComponent(body.job_id)}`)

    case 'clear_pairs':
      return proxyDelete('/distill/pairs')

    case 'export':
      return proxyGet('/distill/export')

    default:
      return NextResponse.json({ error: 'unknown_op' }, { status: 400 })
  }
}
