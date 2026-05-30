#!/usr/bin/env node

const baseUrl = process.env.SMOKE_BASE_URL || 'http://localhost:3000'
const modelId = process.env.SMOKE_MODEL_ID || process.env.OPENAI_MODEL_ID || process.env.ANTHROPIC_MODEL_ID || 'gpt-4o'
const prompt = process.env.SMOKE_PROMPT || 'Reply with one concise sentence proving this is a live standalone Noetica smoke test.'

const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/chat`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    session_id: 'smoke-standalone',
    mode: 'standalone',
    model_id: modelId,
    messages: [
      {
        id: 'smoke-user',
        role: 'user',
        content: prompt,
        created_at: new Date().toISOString()
      }
    ]
  })
})

if (!response.ok || !response.body) {
  const body = await response.text().catch(() => '')
  fail(`HTTP smoke request failed: ${response.status} ${body}`)
}

const events = await readSse(response)
const meta = events.find((event) => event.event === 'meta')?.payload
const done = events.find((event) => event.event === 'done')?.payload
const error = events.find((event) => event.event === 'error')?.payload
const deltas = events.filter((event) => event.event === 'delta')

if (error) fail(`Provider route emitted error: ${error.error}`)
if (!meta?.governance) fail('Missing meta governance event.')
if (!meta.governance.sourceos_interaction_event) fail('Missing meta SourceOS interaction event.')
if (!deltas.length) fail('Missing streamed delta events.')
if (!done?.result?.content?.trim()) fail('Missing completed response content.')
if (!done.result.sourceos_interaction_event) fail('Missing completed SourceOS interaction event.')
if (done.result.sourceos_interaction_event.type !== 'SourceOSInteractionEvent') fail('Invalid SourceOS interaction event type.')
if (!done.result.request_hash || !isSha256(done.result.request_hash)) fail('Missing or invalid request_hash.')
if (!done.result.evidence_hash || !isSha256(done.result.evidence_hash)) fail('Missing or invalid evidence_hash.')
if (!done.result.latency_ms || done.result.latency_ms <= 0) fail('Missing positive latency_ms.')
if (!done.result.model_routed || !done.result.provider) fail('Missing model_routed or provider.')

const summary = {
  ok: true,
  baseUrl,
  model_id_requested: modelId,
  model_routed: done.result.model_routed,
  provider: done.result.provider,
  latency_ms: done.result.latency_ms,
  request_hash: done.result.request_hash,
  evidence_hash: done.result.evidence_hash,
  sourceos_interaction_event_id: done.result.sourceos_interaction_event.interactionEventId,
  deltas: deltas.length,
  content_preview: done.result.content.slice(0, 160)
}

console.log(JSON.stringify(summary, null, 2))

async function readSse(sseResponse) {
  const reader = sseResponse.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const parsed = []

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const parts = buffer.split('\n\n')
    buffer = parts.pop() || ''

    for (const part of parts) {
      const event = parseEvent(part)
      if (event) parsed.push(event)
    }
  }

  return parsed
}

function parseEvent(raw) {
  const lines = raw.split('\n')
  const event = lines.find((line) => line.startsWith('event:'))?.slice(6).trim()
  const data = lines.find((line) => line.startsWith('data:'))?.slice(5).trim()

  if (!event || !data) return undefined

  return {
    event,
    payload: JSON.parse(data)
  }
}

function isSha256(value) {
  return /^[a-f0-9]{64}$/.test(value)
}

function fail(message) {
  console.error(JSON.stringify({ ok: false, error: message }, null, 2))
  process.exit(1)
}
