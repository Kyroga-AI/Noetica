# Noetica Local Service Boundary

Status: Phase 1H boundary contract

## Purpose

Noetica now has a static Tauri build path. The remaining desktop hardening issue is runtime authority. The static UI must not permanently own provider execution, steering execution, route authority, or service lifecycle.

This document defines the minimal service boundary for the transition.

## Current implementation

The current Next API routes remain working browser/dev fallback endpoints:

```text
GET  /api/status
POST /api/chat
POST /api/steer
```

These routes are transitional. They preserve the working development path while the durable runtime boundary moves outward.

## Shared contract

The contract lives at:

```text
lib/contracts/noeticaService.ts
```

It defines:

- `NoeticaChatRequest`
- `NoeticaSteerRequest`
- `NoeticaServiceStatus`
- `NoeticaStreamDoneResult`
- `NoeticaSteerResponse`
- endpoint kind and capability status enums

The client transport now imports chat request and stream result types from this shared contract.

## Endpoint ownership

| Endpoint | Current owner | Target owner | Status |
|---|---|---|---|
| `GET /api/status` | Next fallback route | local service / SourceOS endpoint | fallback status surface |
| `POST /api/chat` | Next fallback route | local service / SourceOS / Agent Machine / model-router boundary | fallback execution surface |
| `POST /api/steer` | Next fallback route | local service / SourceOS / Agent Machine / model-router boundary | fallback steering surface |

## Current fallback status

`GET /api/status` returns `noeticaBrowserFallbackStatus`:

```text
endpoint_kind: browser-fallback
desktop_mode: static-ui
chat: ready
steer: ready
provider: ready
sourceos_route: deferred
agent_machine: deferred
prophet_mesh: deferred
```

This tells the desktop UI that the static shell is active while runtime endpoints are still fallback/transitional.

## Boundary rule

The UI should talk to runtime behavior only through typed transport and service contracts.

The desktop shell owns:

- static UI bundle
- native lifecycle
- onboarding/status display
- route/status display
- empty states and diagnostics

The service side owns:

- chat execution transport
- steering execution transport
- provider/model bridge
- status reporting
- evidence envelope bridge
- future SourceOS / Agent Machine handoff

## Non-goals for this tranche

- No provider migration.
- No SourceOS route integration.
- No Agent Machine handshake.
- No service daemon implementation.
- No Electron fallback.
- No production packaging claim.

## Next tranche

The next implementation tranche should add product command semantics:

```text
noetica app
noetica web
noetica dev
```

and preserve:

```text
noetica start
```

as operational foreground local service/server mode, not the primary user-facing desktop command.
