# ADR-0001: SourceOS Interaction Runtime Bridge

Status: proposed  
Issue: `SocioProphet/Noetica#46`

## Context

Noetica now has:

- a Tauri-first desktop shell;
- a static export path for the desktop shell;
- a typed client transport boundary in `lib/client/noeticaTransport.ts`;
- an initial local service boundary contract in `lib/contracts/noeticaService.ts`;
- fixture-only SourceOS interaction examples under `tests/fixtures/sourceos-interaction/`.

The existing SourceOS interaction substrate is contract-grade across `sourceos-spec`, Noetica, AgentTerm, Superconscious, AgentPlane, and SocioSphere. What is not yet implemented is a live Noetica runtime bridge that exports actual `SourceOSInteractionEvent` records from Noetica.

## Decision

The first runtime bridge implementation should use a bounded local artifact/export path.

The selected initial path is:

```text
Noetica transport/local-service boundary
  -> SourceOSInteractionEvent builder
  -> bounded local JSON artifact export
  -> validation against generated SourceOSInteractionEvent type
  -> optional later AgentTerm import/render
```

## Rationale

A local artifact/export path is the least coupled first implementation because it:

- does not require AgentTerm to be in the default execution path;
- does not require a live WebSocket/SSE channel;
- does not require Policy Fabric, Agent Registry, Memory Mesh, Superconscious, or AgentPlane runtime availability;
- is easy to validate in CI and local development;
- keeps Tauri/static productization independent from event-consumer readiness;
- creates durable evidence for later replay/import work.

## Rejected first paths

### Local endpoint first

A local endpoint such as `GET /events` or `GET /events/:id` is useful later, but it requires more durable local-service lifecycle decisions. It should follow after the artifact path proves event construction and validation.

### SSE/WebSocket first

A stream is appropriate once local consumers exist, but it creates live transport semantics before the substrate has a stable local export shape.

### AgentTerm direct import first

AgentTerm integration should remain opt-in. Noetica should not depend on AgentTerm for normal desktop execution.

### OpsHistory first

OpsHistory is likely the right long-term event-log substrate, but making it the first implementation would conflate event construction with log authority and retention semantics.

## Placement rule

`SourceOSInteractionEvent` emission must attach at the typed transport / local-service boundary.

It must not be emitted directly from `AppShell`, from the Tauri window shell, or from UI state handlers.

## Initial event classes

The first bridge should produce two event shapes:

1. Local service status event.
   - Based on `tests/fixtures/sourceos-interaction/noetica-local-service-status.interaction.json`.
   - Event class: `interaction.governance_trace`.
   - Payload mode: `summary` or `metadata-only`.

2. Chat completion event via transport.
   - Based on `tests/fixtures/sourceos-interaction/noetica-chat-completion-via-transport.interaction.json`.
   - Event class: `interaction.task_completed`.
   - Payload mode: `summary` or `ref-only`.

## Export path

The implementation should choose a deterministic development export path first, for example:

```text
.noetica/events/<interactionEventId>.json
```

A production path should be decided separately with the local service install/runtime contract, for example under an OS app data directory.

## Validation

The first implementation must add validation that exported events conform to the vendored/generated `SourceOSInteractionEvent` type and local fixture expectations.

Validation should run without requiring live model calls, AgentTerm, Superconscious, AgentPlane, Policy Fabric, Agent Registry, or Memory Mesh.

## Payload and privacy rules

Exported events must not include:

- private reasoning;
- raw transcripts;
- raw shell output;
- browser history;
- secrets;
- credentials;
- raw execution logs;
- unrestricted model/provider payloads.

Use summary, metadata-only, ref-only, or bounded inline payloads.

## Authority boundaries

Noetica owns:

- browser/desktop UI presentation;
- typed client dispatch;
- local service boundary placement for its own runtime events.

Noetica does not own:

- SourceOS schema ownership;
- Policy Fabric admission;
- Agent Registry identity/grants/sessions/revocation;
- Memory Mesh durable memory or context-pack semantics;
- AgentPlane execution evidence or replay authority;
- Superconscious task/cognition coordination authority.

## Follow-on work

After the artifact bridge is implemented:

1. Add an AgentTerm import/render command for exported events.
2. Decide whether local endpoint or event stream should expose recent events.
3. Decide whether OpsHistory becomes the durable append-only store.
4. Bind Policy Fabric, Agent Registry, and Memory Mesh references once their runtime boundaries are ready.
5. Add replay demo using exported event artifacts.
