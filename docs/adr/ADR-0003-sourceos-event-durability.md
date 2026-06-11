# ADR-0003: SourceOS Interaction Event Durability

Status: accepted  
Issue: `SocioProphet/Noetica#51`

## Context

Noetica now has a bounded `SourceOSInteractionEvent` runtime bridge:

- `ADR-0001` selected bounded artifact export as the first bridge mechanism.
- `ADR-0002` deferred recent-event endpoint serving until durability is settled.
- Noetica exports event artifacts through a validated export path resolver.
- AgentTerm can import exported artifacts through an opt-in pull/import path.

The remaining question is whether Noetica should own durable event history for exported SourceOS interaction events.

## Decision

Noetica must not become the durable cross-estate event authority by default.

The supported Noetica-owned boundary remains:

```text
Noetica transport / local-service boundary
  -> bounded SourceOSInteractionEvent construction
  -> local JSON artifact export
```

Noetica may write bounded event artifacts, but those artifacts are export records, not the authoritative estate-wide event log.

Durable event authority should be assigned to a separate governed plane before Noetica appends to any durable event store. Candidate durable authority planes include SourceOS / sourceos-syncd or another explicitly governed event authority.

## Rationale

Durable event history requires retention, redaction, replay, indexing, access control, repair, tombstone, migration, and authority semantics.

Those responsibilities exceed Noetica's role as a browser/chat/desktop surface and local interaction runtime surface. Assigning them to Noetica would blur product UI, local runtime, and estate evidence authority.

Keeping Noetica artifact-first preserves:

- clear schema ownership in `sourceos-spec`;
- clear artifact ownership in Noetica;
- opt-in AgentTerm import/render;
- future durable authority assignment without migration ambiguity;
- explicit retention and redaction decisions;
- compatibility with SourceOS/sourceos-syncd local-first durability work.

## Rejected now

### Noetica as durable event store

Rejected because it would make a product/runtime surface into the durable cross-estate authority.

### Immediate append to OpsHistory

Deferred because append-only semantics require retention, redaction, replay, and repair rules. Those rules must be decided before append behavior lands.

### Recent-event endpoint backed by in-process memory

Rejected because in-process recent-event memory creates implicit retention and endpoint semantics without a real durability model.

## Allowed future shapes

A future tranche may choose one of these shapes after durable authority is settled:

1. Artifact-only, with AgentTerm/import consumers.
2. Artifact export plus a read-only local index.
3. Artifact export plus append into a governed event store.
4. Artifact export handed to SourceOS/sourceos-syncd for local-first durability.

## Boundary rules

- Noetica owns event construction and bounded artifact export only.
- Noetica does not own estate-wide durability by default.
- AgentTerm remains an opt-in consumer, not the durable authority.
- Policy Fabric, Agent Registry, Memory Mesh, AgentPlane, and Superconscious authority remains outside Noetica.
- No raw transcripts, private reasoning, raw shell output, browser history, secrets, credentials, unrestricted provider payloads, or raw execution logs may be stored as durable event payloads.

## Follow-on work

Open a follow-on implementation issue only after a durable authority plane is selected.

Until then, keep the bridge artifact-first and validated by CI.
