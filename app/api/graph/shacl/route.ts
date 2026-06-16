import { NextResponse } from 'next/server'
import { validateGraph, applyRules } from '@/lib/hellgraph/shacl'
import { getHellGraph } from '@/lib/hellgraph/store'
import { shaclValidate, shaclApplyRules } from '@/lib/hellgraph/sidecar'

export const runtime = 'nodejs'

type SHACLBody = {
  /** 'validate' checks conformance; 'rules' derives new triples. */
  op: 'validate' | 'rules'
  /** Raw Turtle text of the SHACL shapes graph. */
  shapes: string
  /**
   * When true, delegate to the OpenCog sidecar (pyshacl) for full W3C
   * compliance. Falls back to the built-in TS engine if sidecar is offline.
   */
  useSidecar?: boolean
}

export async function POST(request: Request) {
  const body = (await request.json()) as SHACLBody

  if (!body.shapes?.trim())
    return NextResponse.json({ error: 'shapes_required' }, { status: 400 })

  const store = getHellGraph()

  try {
    if (body.op === 'validate') {
      if (body.useSidecar) {
        try {
          const result = await shaclValidate(body.shapes)
          if (result) return NextResponse.json(result)
        } catch { /* sidecar offline — fall through to TS engine */ }
      }
      return NextResponse.json(validateGraph(store, body.shapes))
    }

    if (body.op === 'rules') {
      if (body.useSidecar) {
        try {
          const result = await shaclApplyRules(body.shapes)
          if (result) return NextResponse.json(result)
        } catch { /* sidecar offline — fall through to TS engine */ }
      }
      const added = applyRules(store, body.shapes)
      return NextResponse.json({ added })
    }

    return NextResponse.json({ error: 'unknown_op' }, { status: 400 })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'shacl_failed' },
      { status: 500 }
    )
  }
}
