import { NextResponse } from 'next/server'
import { models } from '@/config/models'
import type { ChatMessage } from '@/lib/types/message'
import type { SteeringConfig } from '@/lib/types/steering'
import { callAnthropic } from '@/lib/providers/anthropic'
import { callOpenAI } from '@/lib/providers/openai'
import { submitTask } from '@/lib/superconscious/adapter'

type ChatRequest = {
  session_id?: string
  mode?: 'standalone' | 'sourceos'
  model_id?: string
  messages?: ChatMessage[]
  steering?: SteeringConfig
  memory_scope?: string
}

export async function POST(request: Request) {
  const body = (await request.json()) as ChatRequest
  const mode = body.mode ?? 'standalone'
  const messages = body.messages ?? []
  const latest = messages[messages.length - 1]

  if (!latest?.content?.trim()) {
    return NextResponse.json({ error: 'message_required' }, { status: 400 })
  }

  const model = models.find((candidate) => candidate.id === body.model_id) ?? models[0]

  if (body.steering && model.steering === 'none') {
    return NextResponse.json(
      { error: 'model_not_steering_capable', model_id: model.id, steering: model.steering },
      { status: 400 }
    )
  }

  if (body.steering && model.steering === 'local' && mode === 'standalone') {
    return NextResponse.json(
      { error: 'local_steering_requires_sourceos', model_id: model.id, steering: model.steering },
      { status: 400 }
    )
  }

  if (mode === 'sourceos') {
    const result = await submitTask({
      session_id: body.session_id ?? crypto.randomUUID(),
      message: latest.content,
      mode,
      model_hint: model.id,
      steering: body.steering,
      memory_scope: body.memory_scope
    })

    return NextResponse.json({ result })
  }

  if (model.provider === 'openai') {
    const result = await callOpenAI({ model: model.id, messages })
    return NextResponse.json({ result })
  }

  if (model.provider === 'anthropic') {
    const result = await callAnthropic({ model: model.id, messages })
    return NextResponse.json({ result })
  }

  return NextResponse.json(
    {
      error: 'provider_not_implemented_in_m1',
      provider: model.provider,
      model_id: model.id
    },
    { status: 501 }
  )
}
