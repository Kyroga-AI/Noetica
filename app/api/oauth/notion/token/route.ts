import { NextRequest, NextResponse } from 'next/server'

// Notion requires Basic auth (client_id:client_secret) for token exchange.
// The client sends client_id and client_secret in the request body;
// this proxy extracts them, builds the Basic auth header, and forwards.
export async function POST(req: NextRequest) {
  const body = await req.text()
  const params = new URLSearchParams(body)

  const clientId = params.get('client_id') ?? ''
  const clientSecret = params.get('client_secret') ?? ''
  params.delete('client_secret')

  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')

  const res = await fetch('https://api.notion.com/v1/oauth/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${basicAuth}`,
    },
    body: JSON.stringify(Object.fromEntries(params)),
  })

  if (!res.ok) {
    return NextResponse.json({ error: 'upstream_error' }, { status: 502 })
  }

  const data = await res.json()
  return NextResponse.json(data)
}
