# Noetica Adapter Contract Hardening

Status: contract scaffold. No live model-router or memory-mesh integration is implemented here.

## Purpose

Noetica references model routing and memory scopes in the UI and SourceOS contract. Those references must not become implicit authority claims. This document records the adapter boundaries for `model-router` and `memory-mesh` until live SourceOS integration is admitted.

## Model Router adapter

Code:

- `lib/types/model-router.ts`
- `lib/model-router/adapter.ts`

Authority repo: `SocioProphet/model-router`.

Noetica may request or display a route decision. Noetica does not own:

- route optimization
- budget/resource decisions
- provider health decisions
- quota decisions
- lane escalation
- prompt-egress policy
- canonical route evidence

Current stub behavior:

- returns `status: "stubbed"`
- sets `authority: "SocioProphet/model-router"`
- sets `live_route_performed: false`
- preserves the distinction between `model_hint` and `model_routed`
- records `model_overridden`
- records prompt-egress posture as a view only
- points route evidence to pending Agentplane refs

The stub is intentionally renderable but not authoritative.

## Memory Mesh adapter

Code:

- `lib/types/memory.ts`
- `lib/memory-mesh/adapter.ts`

Authority repo: `SocioProphet/memory-mesh`.

Noetica may display scopes, request recall, or submit a write proposal. Noetica does not own:

- recall policy
- durable writeback
- memory persistence
- sensitive payload storage
- review/admission policy for memory proposals

Current stub behavior:

- `listMemoryScopes()` returns a session-local non-live scope.
- `recallMemory()` returns no entries and `recall_performed: false`.
- `proposeMemoryWrite()` returns `not-submitted`, `durable_write_performed: false`, and `review_required: true`.

The stub is intentionally conservative: no live recall, no durable writeback, no raw payload storage.

## Non-goals

This contract hardening does not:

- call `model-router`
- call `memory-mesh`
- persist memory
- authorize model routes
- admit provider access
- change M2a live smoke status
- change M3 Superconscious runtime status

## Future integration

When SourceOS mode becomes live, Noetica should replace these stubs with adapters that call the authority repos or Superconscious-mediated authority surfaces. The TypeScript interfaces should remain stable unless the authority repos publish a stricter shared schema.
