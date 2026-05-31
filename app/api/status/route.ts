import { NextResponse } from 'next/server'
import { noeticaBrowserFallbackStatus } from '@/lib/contracts/noeticaService'

export async function GET() {
  return NextResponse.json(noeticaBrowserFallbackStatus)
}
