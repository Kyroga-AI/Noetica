import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  const body = await req.text()
  const params = new URLSearchParams(body)

  const res = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: params.toString(),
  })

  if (!res.ok) {
    return NextResponse.json({ error: 'upstream_error' }, { status: 502 })
  }

  const data = await res.json()
  if (data.error) {
    return NextResponse.json(data, { status: 400 })
  }

  return NextResponse.json(data)
}
