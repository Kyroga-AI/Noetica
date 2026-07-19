/** Tests for the Reasoner SERVICE over a mock event bus (lib/reasoner-bus.ts) — proves the event-driven
 *  shape (§4/§8) works end-to-end against fakes, with no Kafka/infra. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  InMemoryBus, ReasonerService, TOPIC_STRUCTURE_IN, TOPIC_INFER_OUT, TOPIC_INFER_ERROR,
  type Envelope, type InferResultPayload,
} from './reasoner-bus.js'
import type { ReasonerInput } from './reasoner.js'

const env = (id: string): Envelope => ({
  message_id: id, trace_id: `trace-${id}`, span_id: `span-${id}`,
  emitted_at: new Date().toISOString(), schema_version: '0.1.0',
})

test('service consumes a structure event and emits an mln.infer.v1 verdict', () => {
  const bus = new InMemoryBus()
  new ReasonerService(bus).start()
  const input: ReasonerInput = { claims: ['c1'], detectorFirings: [] }
  bus.publish<ReasonerInput>(TOPIC_STRUCTURE_IN, env('m1'), input)

  const out = bus.emittedOn(TOPIC_INFER_OUT)
  assert.equal(out.length, 1)
  const payload = out[0]!.payload as InferResultPayload
  assert.equal(payload.clear, true)
  assert.equal(payload.verdicts[0]!.severity, 'pass')
})

test('trace_id propagates UNCHANGED from the input envelope to the emitted verdict (§4)', () => {
  const bus = new InMemoryBus()
  new ReasonerService(bus).start()
  bus.publish<ReasonerInput>(TOPIC_STRUCTURE_IN, env('m2'), { claims: ['c1'], detectorFirings: [] })

  const out = bus.emittedOn(TOPIC_INFER_OUT)[0]!
  assert.equal(out.envelope.trace_id, 'trace-m2')                 // same trace
  assert.match(out.envelope.span_id, /span-m2\.reason$/)          // child span
  const payload = out.payload as InferResultPayload
  assert.equal(payload.source_message_id, 'm2')                    // provenance link (§3.1 DG-1)
})

test('an HC_VIOLATION input emits on mln.infer.error.v1, not the success topic', () => {
  const bus = new InMemoryBus()
  new ReasonerService(bus).start()
  const bad: ReasonerInput = { claims: ['c1'], detectorFirings: [{ ruleId: 'X', targetClaim: 'c1', score: Infinity }] }
  bus.publish<ReasonerInput>(TOPIC_STRUCTURE_IN, env('m3'), bad)

  assert.equal(bus.emittedOn(TOPIC_INFER_OUT).length, 0)
  const errs = bus.emittedOn(TOPIC_INFER_ERROR)
  assert.equal(errs.length, 1)
  assert.equal((errs[0]!.payload as { reason: string }).reason, 'HC_VIOLATION')
})

test('a blocking claim rides through the service and surfaces as clear=false', () => {
  const bus = new InMemoryBus()
  new ReasonerService(bus).start()
  const input: ReasonerInput = {
    claims: ['c1'], detectorFirings: [],
    policyConstraints: [{ claim: 'c1', reason: 'POLICY.HARD.V1' }],
  }
  bus.publish<ReasonerInput>(TOPIC_STRUCTURE_IN, env('m4'), input)

  const payload = bus.emittedOn(TOPIC_INFER_OUT)[0]!.payload as InferResultPayload
  assert.equal(payload.clear, false)
  assert.equal(payload.verdicts[0]!.severity, 'block')
})

test('the mock bus is swappable: a second subscriber sees the same emitted verdicts', () => {
  const bus = new InMemoryBus()
  new ReasonerService(bus).start()
  const seen: string[] = []
  bus.subscribe<InferResultPayload>(TOPIC_INFER_OUT, (m) => seen.push(m.payload.source_message_id))
  bus.publish<ReasonerInput>(TOPIC_STRUCTURE_IN, env('m5'), { claims: ['c1'], detectorFirings: [] })
  assert.deepEqual(seen, ['m5'])
})
