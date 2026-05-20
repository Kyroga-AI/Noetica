# M3 Superconscious Contract Scaffold

Status: contract scaffold. No live SourceOS runtime is implemented by this document.

## Purpose

Noetica needs a stable contract for SourceOS mode before either Noetica or Superconscious implements live submission. This document defines the Noetica-side task submission and task result shape so both repositories can develop against the same boundary.

M3 prep is not a runtime integration. It is a contract-hardening step.

## Authority boundary

Noetica owns:

- chat surface
- steering UX
- governance trail rendering
- provider abstraction view
- Superconscious adapter interface

Noetica does not own:

- policy admission
- model routing
- agent identity or tool grants
- memory persistence
- evidence or replay authority
- SourceOS runtime execution

Authority mapping:

| Plane | Authority repo | Noetica contract field |
| --- | --- | --- |
| Agent identity / grants | `SocioProphet/agent-registry` | `agent_id`, `tool_grant_refs`, `grant_refs` |
| Policy admission | guardrail / policy fabric | `policy_admitted`, `policy_ref` |
| Model routing | `SocioProphet/model-router` | `model_hint`, `model_routed`, `model_overridden` |
| Memory | `SocioProphet/memory-mesh` | `memory_scope_ref`, `memory_written` |
| Evidence / replay | `SocioProphet/agentplane` | `agentplane_run_id`, `evidence_ref`, `replay_ref`, `provider_route_evidence` |
| Cognition loop | `SocioProphet/superconscious` | `run_id`, task result assembly |

## Task submission

Canonical TypeScript interface: `lib/types/task.ts`.

```ts
export interface NoeticaTaskInput {
  schema_version: 'noetica.task.v0.1'
  session_id: string
  agent_id: 'noetica'
  message: string
  mode: 'standalone' | 'sourceos'
  model_hint?: string
  steering_hint?: SteeringConfig
  tool_grant_refs: string[]
  memory_scope_ref?: string
  request_hash: string
  agentplane_evidence_ref?: string
}
```

Field rules:

- `agent_id` must be `noetica` and must correspond to the `agent-registry` manifest.
- `tool_grant_refs` are grant anchors only. They are not credentials and do not imply admission.
- `request_hash` must be computed by Noetica before submission.
- `model_hint` is advisory. Superconscious / model-router may override it.
- `steering_hint` is advisory and must still obey the `full | local | none` capability model.
- `memory_scope_ref` is a memory-mesh scope reference, not memory content.

## Task result

Canonical TypeScript interface: `lib/types/task.ts`.

```ts
export interface NoeticaTaskResult {
  schema_version: 'noetica.task.v0.1'
  status: 'accepted' | 'blocked' | 'unavailable' | 'stubbed'
  run_id: string
  content: string
  model_routed: string
  provider: string
  model_overridden: boolean
  policy_admitted: boolean
  policy_ref?: string
  grant_refs: {
    requested: string[]
    resolved: string[]
    missing: string[]
  }
  steering_applied?: SteeringResult
  memory_written: boolean
  memory_scope_ref?: string
  agentplane_run_id?: string
  evidence_ref?: string
  replay_ref?: string
  provider_route_evidence?: ExternalModelProviderRouteEvidence
  request_hash?: string
  evidence_hash?: string
  timestamp?: string
  latency_ms: number
}
```

Result rules:

- `run_id` is the Superconscious reasoning-run identifier when live; in stub mode it is a clearly prefixed stub identifier.
- `model_routed` records what model was actually selected.
- `model_overridden` must be true when model-router changes the input hint.
- `policy_admitted` and `policy_ref` report guardrail / policy fabric posture.
- `grant_refs` must show requested, resolved, and missing grants separately.
- `memory_written` must remain false unless memory-mesh accepted a write.
- `evidence_ref` and `replay_ref` are Agentplane references, not Noetica-owned proof claims.
- `provider_route_evidence` must remain Agentplane schema-compatible.

## Mode behavior

### Standalone mode

Standalone mode bypasses the Superconscious adapter. Direct provider calls are handled by Noetica's local standalone route.

If `submitTask()` is called with `mode: 'standalone'`, the adapter returns a typed `status: 'stubbed'` result explaining that standalone routing bypasses Superconscious.

Standalone mode may use runtime environment variables. Agent-registry grant resolution is not performed in M2a.

### SourceOS mode

SourceOS mode is contract-only at M3-prep time.

If `submitTask()` is called with `mode: 'sourceos'`, the adapter returns a typed `status: 'unavailable'` result with `policy_admitted: false`.

The stub must not:

- call Superconscious over the network
- call model-router
- call memory-mesh
- resolve agent-registry grants
- store credentials
- emit real Agentplane replay artifacts

## Current stub behavior

The current stub produces:

- `status: 'unavailable'`
- `provider: 'superconscious'`
- `model_routed` equal to `model_hint` or `model-router-pending`
- `grant_refs.requested` copied from `tool_grant_refs`
- `grant_refs.resolved` empty
- `grant_refs.missing` equal to all requested grants
- `memory_written: false`
- pending policy/evidence/replay references
- local `request_hash` and stub `evidence_hash`

This is intentionally renderable by Noetica's governance trail but not an admission of SourceOS runtime authority.

## Superconscious validation request

Superconscious contributors should validate this contract against the current cognition-loop architecture:

```text
Task input
  -> validate
  -> plan
  -> request policy admission
  -> request model route
  -> activate skill
  -> call tool adapter
  -> record observation
  -> decide memory handling
  -> request approval when needed
  -> emit safe operational trace
  -> emit AgentPlane evidence
  -> emit replay plan
  -> run benchmark assertions
```

The first live integration should not require changing the Noetica contract shape. It should replace the stub implementation behind `submitTask()`.

## Non-goals

- No live SourceOS endpoint call.
- No production grant admission.
- No provider credential handling.
- No model-router runtime dependency.
- No memory writes.
- No real Agentplane replay emission.
