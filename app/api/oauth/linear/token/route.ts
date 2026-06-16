import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  const body = await req.text()
  const params = new URLSearchParams(body)

  const res = await fetch('https://api.linear.app/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  })

  if (!res.ok) {
    return NextResponse.json({ error: 'upstream_error' }, { status: 502 })
  }

  const data = await res.json()
  return NextResponse.json(data)
}
