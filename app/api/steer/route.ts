import { NextResponse } from 'next/server'
import { runNeuronpediaSteering } from '@/lib/providers/neuronpedia'
import type { SteeringConfig } from '@/lib/types/steering'

type SteerRequest = {
  prompt?: string
  model_id?: string
  steering?: SteeringConfig
}

export async function POST(request: Request) {
  const body = (await request.json()) as SteerRequest

  if (!body.prompt?.trim()) {
    return NextResponse.json({ error: 'prompt_required' }, { status: 400 })
  }

  if (!body.model_id?.trim()) {
    return NextResponse.json({ error: 'model_id_required' }, { status: 400 })
  }

  if (!body.steering) {
    return NextResponse.json({ error: 'steering_required' }, { status: 400 })
  }

  const result = await runNeuronpediaSteering({
    prompt: body.prompt,
    model_id: body.model_id,
    steering: body.steering
  })

  return NextResponse.json({ result })
}
