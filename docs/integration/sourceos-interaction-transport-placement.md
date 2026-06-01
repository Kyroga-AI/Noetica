# SourceOS Interaction Transport Placement

Status: placement guidance for the Phase 1H desktop/local-service architecture

## Purpose

Noetica now has a Tauri-first desktop shell, a static export path, a typed client transport boundary, and an initial local service boundary contract. SourceOS interaction emission must attach to those boundaries rather than to UI components directly.

This document aligns the existing SourceOS interaction substrate with Noetica's current product direction.

## Placement rule

`SourceOSInteractionEvent` emission should be owned by the transport/local-service boundary, not by `AppShell` and not by the Tauri window shell.

Preferred future path:

```text
AppShell
  -> lib/client/noeticaTransport.ts
  -> Noetica local service boundary
  -> SourceOSInteractionEvent
  -> optional AgentTerm / Superconscious / AgentPlane refs
```

Fallback/dev path:

```text
AppShell
  -> lib/client/noeticaTransport.ts
  -> Next API fallback route
  -> SourceOSInteractionEvent-compatible response metadata
```

## Boundary commitments

- `AppShell` owns presentation and interaction state.
- `lib/client/noeticaTransport.ts` owns typed client dispatch and stream parsing.
- The local service boundary owns durable execution/status semantics for desktop mode.
- Next API routes remain browser/dev fallback surfaces until the service boundary replaces them.
- The Tauri shell owns native window/lifecycle behavior and must not become the policy, memory, evidence, or schema authority.
- SourceOS event schema ownership remains in `SourceOS-Linux/sourceos-spec`.

## Interaction substrate mapping

| SourceOS field family | Noetica placement |
| --- | --- |
| `surface` | Noetica UI or desktop shell metadata. |
| `mode` | `standalone`, `sourceos`, `dry-run`, or `replay` depending on runtime context. |
| `session` | Transport/local-service session reference. |
| `actor` / `participants` | Agent Registry-backed refs when available; local placeholders only in standalone mode. |
| `task` | Transport/local-service request lifecycle. |
| `steeringIntent` | Steering request metadata from UI, not authority to execute. |
| `governanceTrace` | Policy, grant, memory, route, evidence, and replay refs only. |
| `payload` | Bounded summary or reference-only payload. |

## Non-goals

- Do not wire live AgentTerm export in this placement tranche.
- Do not move Policy Fabric, Agent Registry, Memory Mesh, AgentPlane, or SourceOS schema authority into Noetica.
- Do not emit private reasoning, raw transcripts, raw shell output, browser history, secrets, credentials, or raw execution logs.
- Do not block the Tauri/static productization lane on this guidance.

## Fixture expectations

The fixture-only examples under `tests/fixtures/sourceos-interaction/` model the intended future local-service emission shape:

- `noetica-local-service-status.interaction.json`
- `noetica-chat-completion-via-transport.interaction.json`

They are examples for future runtime wiring and should remain non-authoritative until the local service boundary is implemented.
