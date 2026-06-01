# Noetica UI Status Surface

Status: Phase 1H desktop hardening tranche

## Purpose

The desktop shell must tell the operator what is ready, missing, disabled, or deferred without requiring JSON inspection or terminal output.

This tranche adds a compact top-bar status surface backed by the local service boundary contract.

## Implementation

The client loader lives at:

```text
lib/client/noeticaStatus.ts
```

The UI component lives at:

```text
components/status/RuntimeStatus.tsx
```

The component reads:

```text
GET /api/status
```

and displays:

```text
mode
runtime
provider
sourceos
agent
mesh
```

## Current expected display

For the current fallback implementation, the status should indicate:

```text
mode: static-ui
runtime: browser-fallback
provider: ready
sourceos: deferred
agent: deferred
mesh: deferred
```

## Boundary

This tranche does not create a service daemon. It only makes the fallback/runtime boundary visible in the desktop UI.

## Non-goals

- No provider/runtime migration.
- No SourceOS route integration.
- No Agent Machine handshake.
- No packaging/signing work.
- No Electron fallback.
