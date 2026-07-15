import { NextResponse } from 'next/server'
import { noeticaBrowserFallbackStatus } from '@/lib/contracts/noeticaService'

// Stubbed in the Tauri static export (output:export requires GET route handlers to opt into
// static generation). The desktop app calls agent-machine's own endpoint, never this Next route.
export const dynamic = 'force-static'

export async function GET() {
  return NextResponse.json(noeticaBrowserFallbackStatus)
}
