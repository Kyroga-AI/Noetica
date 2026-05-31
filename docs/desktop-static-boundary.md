# Noetica Desktop Static UI / Service Boundary Gate

Status: Phase 1H Turn 2 implementation in progress

## Purpose

Turn 1 proved that the Tauri feasibility shell can compile and build on macOS. Turn 2 determines whether Noetica can move from a dev-server-backed desktop shell to a Tauri-compatible static frontend, and which responsibilities must leave the bundled UI.

This is an architecture gate. It is not UX polish, SourceOS route integration, Agent Machine readiness work, Electron fallback, or production packaging.

## Current evidence

### Tauri still points at a Next build artifact

`src-tauri/tauri.conf.json` currently uses:

```json
"frontendDist": "../.next"
```

That is sufficient for feasibility CI, but it is not the intended final static frontend boundary. The next target should be a static export directory such as `../out` after the server/API responsibilities are split out.

### The UI shell is mostly static-capable

`app/page.tsx` delegates to `components/shell/AppShell.tsx`.

The `AppShell` component is a client component with local React state for messages, model selection, mode, steering configuration, and stream state. This is compatible with a static bundled UI in principle.

The primary frontend blocker was transport authority: `AppShell` posted chat execution directly to `/api/chat` and consumed server-sent events from that route.

### `/api/chat` is not static UI

`app/api/chat/route.ts` is explicitly a Node runtime route:

```ts
export const runtime = 'nodejs'
```

It owns request validation, provider/model dispatch, external execution calls, SourceOS-mode task submission, evidence envelope creation, and SSE framing. Therefore Noetica is not yet statically exportable as a complete product while retaining live chat behavior.

## Implemented so far

### Client transport boundary

The UI now has a typed client transport boundary:

```text
lib/client/noeticaTransport.ts
```

`AppShell` now calls `sendNoeticaChat(...)` instead of hard-coding `fetch('/api/chat')` and local SSE parsing. The transport defaults to `/api/chat` so the current browser/dev fallback remains intact, but the endpoint can be redirected through `NEXT_PUBLIC_NOETICA_CHAT_ENDPOINT` or an explicit transport config.

### Static export probe

This tranche adds an environment-gated static export mode:

```text
NOETICA_STATIC_EXPORT=1
```

When that variable is set, `next.config.mjs` enables:

```js
output: 'export'
```

The probe command is:

```bash
npm run build:static:probe
```

The probe writes:

```text
artifacts/static-export-probe.md
artifacts/static-export-probe.log
```

CI runs the probe after the normal Next build and uploads the report/log as artifacts. The probe records pass/fail evidence but does not fail the whole validation workflow.

## Decision

Noetica should continue Tauri-first, but the desktop app must be split into:

```text
Tauri desktop shell
  Owns:
    static UI bundle
    native lifecycle
    desktop command entrypoint
    onboarding/status surfaces
    provider setup UX
    route/status display
    empty states and diagnostics

Noetica local service or SourceOS/Agent Machine endpoint
  Owns:
    chat execution transport
    streaming protocol
    provider/model routing bridge until model-router owns it
    standalone diagnostic provider smoke bridge
    SourceOS readiness/status bridge
    governance/evidence envelope emission until delegated outward

SourceOS / Agent Machine / model-router / policy / memory
  Own:
    durable runtime authority
    worker/provider activation
    model selection
    policy admission
    memory scope and writes
    execution evidence and replay authority
```

## Static export classification

| Surface | Current file/path | Static UI viable? | Owner after split | Notes |
|---|---|---:|---|---|
| Root page | `app/page.tsx` | Yes | Noetica UI | Thin page wrapper around `AppShell`. |
| App shell rendering | `components/shell/AppShell.tsx` | Mostly yes | Noetica UI | Client state and rendering are static-compatible. |
| Chat execution request | `lib/client/noeticaTransport.ts` | Boundary introduced | Local service / SourceOS endpoint | Defaults to `/api/chat`, but no longer hard-coded in `AppShell`. |
| Chat SSE parsing | `lib/client/noeticaTransport.ts` | Yes | Noetica UI | Parser is transport-owned and reusable across endpoint implementations. |
| Provider calls | `lib/providers/openai.ts`, `lib/providers/anthropic.ts` | No | Local service / model-router/provider layer | Requires external runtime authority. |
| SourceOS task submission | `lib/superconscious/adapter.ts` via `/api/chat` | No | SourceOS / Agent Machine endpoint | Adapter should remain an interface, not UI authority. |
| CLI foreground server | `noetica start` | Not product UI | Operational local service/server mode | Must not be the primary desktop UX. |
| Tauri shell | `src-tauri/*` | Yes | Noetica desktop shell | Should eventually load static UI from export output. |
| Static export probe | `scripts/probe-static-export.mjs` | Evidence pending | Noetica UI | CI artifact records whether `output: 'export'` currently succeeds. |

## Remaining implementation shape

### 1. Preserve `/api/chat` only as browser fallback for now

Do not delete the route in the first static-boundary patch. Reclassify it as browser/dev fallback or transitional local-service code. Moving it all at once risks breaking the working path before the static UI is proven.

### 2. Interpret static export probe output

If the static export probe passes, the next tranche can point a Tauri-specific build path at static output and validate `frontendDist` against the exported directory.

If the probe fails, the static-export report/log becomes the blocker register input. Each blocker must be assigned to one owner:

- Noetica UI refactor
- Noetica thin local service
- SourceOS endpoint
- Agent Machine endpoint
- model-router / policy / memory layer

## Acceptance criteria for Turn 2 closeout

Turn 2 is complete only when one of these is true:

### Preferred path

- UI chat execution goes through a typed transport abstraction.
- `/api/chat` is classified as fallback/transitional, not core desktop authority.
- A static export probe exists and has an explicit pass/fail result.
- Tauri config has a clear path to `frontendDist` static output.

### Blocked path

- A blocker list exists with each blocker assigned to one owner:
  - Noetica UI refactor
  - Noetica thin local service
  - SourceOS endpoint
  - Agent Machine endpoint
  - model-router / policy / memory layer

## Non-goals

- Do not start Electron fallback.
- Do not make Noetica the durable provider/runtime authority.
- Do not start SourceOS route integration in this tranche.
- Do not make `noetica start` the primary desktop UX.
- Do not claim production packaging readiness.
