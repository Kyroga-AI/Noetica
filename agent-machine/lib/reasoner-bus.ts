/**
 * reasoner-bus — a minimal event-bus interface + in-memory mock, so the Reasoner is a runnable SERVICE
 * against fakes, not just a library. This proves the event-driven shape the spec's §4 describes (consume
 * argmine.structure.v1 + detector evidence, emit mln.infer.v1) WITHOUT provisioning Kafka/NATS.
 *
 * The interface is deliberately the minimal surface a real Kafka/NATS adapter would implement — swap
 * InMemoryBus for a KafkaBus later with zero change to ReasonerService. This is the seam that keeps the
 * infrastructure decision (which the user has NOT made) out of the reasoning logic.
 *
 * The spec's common envelope (message_id, trace_id, span_id, emitted_at, schema_version) is carried on
 * every message — UNCHANGED from the base spec, required on all topics (§4).
 */
import { reason, type ReasonerInput, type ReasonerVerdict } from './reasoner.js'

export interface Envelope {
  message_id: string
  trace_id: string
  span_id: string
  emitted_at: string        // RFC3339
  schema_version: string
}

export interface BusMessage<T = unknown> {
  topic: string
  envelope: Envelope
  payload: T
}

/** The minimal bus surface. A KafkaBus/NatsBus implements exactly this; nothing above it knows which. */
export interface EventBus {
  publish<T>(topic: string, envelope: Envelope, payload: T): void
  subscribe<T>(topic: string, handler: (msg: BusMessage<T>) => void): void
}

/** In-memory synchronous mock bus — for tests and local dev. Records every published message so a test
 *  can assert what the service emitted. Delivery is synchronous (publish runs subscribers inline), which
 *  makes tests deterministic; a real bus would be async, but the service logic is identical either way. */
export class InMemoryBus implements EventBus {
  private handlers = new Map<string, Array<(msg: BusMessage) => void>>()
  readonly published: BusMessage[] = []

  publish<T>(topic: string, envelope: Envelope, payload: T): void {
    const msg: BusMessage<T> = { topic, envelope, payload }
    this.published.push(msg as BusMessage)
    for (const h of this.handlers.get(topic) ?? []) h(msg as BusMessage)
  }

  subscribe<T>(topic: string, handler: (msg: BusMessage<T>) => void): void {
    const list = this.handlers.get(topic) ?? []
    list.push(handler as (m: BusMessage) => void)
    this.handlers.set(topic, list)
  }

  /** Test helper: every message published on a topic. */
  emittedOn(topic: string): BusMessage[] {
    return this.published.filter((m) => m.topic === topic)
  }
}

export const TOPIC_STRUCTURE_IN = 'argmine.structure.v1'   // §4: what the Reasoner consumes
export const TOPIC_INFER_OUT = 'mln.infer.v1'              // §4: MAP result
export const TOPIC_INFER_ERROR = 'mln.infer.error.v1'     // §4: HC_VIOLATION | TIMEOUT | UNSAT_HARD_CONSTRAINT

export interface InferResultPayload extends ReasonerVerdict {
  source_message_id: string   // provenance: which structure message produced this verdict (§3.1 Rule DG-1)
}

/**
 * The Reasoner service: subscribe to structure events, run Tier-A reasoning, publish the verdict (or an
 * error). This is the §8 service's synchronous core with a mock bus — the piece that becomes a real
 * gRPC/Kafka service by swapping the bus impl and adding the Tier-B async pool (not built; needs infra).
 */
export class ReasonerService {
  constructor(private bus: EventBus, private schemaVersion = '0.1.0') {}

  start(): void {
    this.bus.subscribe<ReasonerInput>(TOPIC_STRUCTURE_IN, (msg) => this.onStructure(msg))
  }

  private onStructure(msg: BusMessage<ReasonerInput>): void {
    const outEnvelope: Envelope = {
      message_id: `mln-${msg.envelope.message_id}`,
      trace_id: msg.envelope.trace_id,          // trace propagates UNCHANGED (§4 common envelope)
      span_id: `${msg.envelope.span_id}.reason`,
      emitted_at: new Date().toISOString(),
      schema_version: this.schemaVersion,
    }
    let verdict: ReasonerVerdict
    try {
      verdict = reason(msg.payload)
    } catch (e) {
      this.bus.publish(TOPIC_INFER_ERROR, outEnvelope, { reason: 'REASONER_ERROR', detail: String((e as Error).message).slice(0, 200), source_message_id: msg.envelope.message_id })
      return
    }
    if (verdict.hcViolation) {
      this.bus.publish(TOPIC_INFER_ERROR, outEnvelope, { reason: 'HC_VIOLATION', detail: verdict.hcViolation, source_message_id: msg.envelope.message_id })
      return
    }
    const payload: InferResultPayload = { ...verdict, source_message_id: msg.envelope.message_id }
    this.bus.publish(TOPIC_INFER_OUT, outEnvelope, payload)
  }
}
