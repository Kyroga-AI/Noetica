import { NextResponse } from 'next/server'

export const runtime = 'nodejs'

const TEACHER_URL = process.env.TEACHER_CACHE_URL ?? 'http://127.0.0.1:8140'

async function proxy(path: string, method: string, body?: unknown) {
  try {
    const res = await fetch(`${TEACHER_URL}${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(method === 'POST' && path === '/teacher/cache' ? 120_000 : 15_000),
    })
    const json = await res.json()
    return NextResponse.json(json, { status: res.status })
  } catch {
    return NextResponse.json({ error: 'teacher_cache_server_unavailable' }, { status: 503 })
  }
}

type TeacherPostBody =
  | { op: 'load'; model_id: string }
  | { op: 'cache'; pairs: unknown[]; max_seq_len?: number }

export async function GET() {
  return proxy('/teacher/health', 'GET')
}

export async function POST(request: Request) {
  const body = (await request.json()) as TeacherPostBody
  switch (body.op) {
    case 'load':
      return proxy('/teacher/load', 'POST', { model_id: body.model_id })
    case 'cache':
      return proxy('/teacher/cache', 'POST', { pairs: body.pairs, max_seq_len: body.max_seq_len })
    default:
      return NextResponse.json({ error: 'unknown_op' }, { status: 400 })
  }
}
