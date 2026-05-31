# Noetica Desktop Static UI / Service Boundary Gate

Status: Phase 1H Turn 2 decision artifact

## Purpose

Turn 1 proved that the Tauri feasibility shell can compile and build on macOS. Turn 2 determines whether Noetica can move from a dev-server-backed desktop shell to a Tauri-compatible static frontend, and which responsibilities must leave the bundled UI.

This is an architecture gate. It is not UX polish, SourceOS route integration, Agent Machine readiness work, Electron fallback, or production packaging.

## Current evidence

### Tauri still points at a Next build artifact

`src-tauri/tauri.conf.json` currently uses:

```json
"frontendDist": "../.next"
```

That is sufficient for feasibility CI, but it is not the intended final static frontend boundary. The next target should be a static export directory such as `../out` only after the server/API responsibilities below are split out.

### The UI shell is mostly static-capable

`app/page.tsx` delegates to `components/shell/AppShell.tsx`.

The `AppShell` component is a client component with local React state for messages, model selection, mode, steering configuration, and stream state. This is compatible with a static bundled UI in principle.

The primary frontend blocker is not rendering. The blocker is transport authority: `AppShell` currently posts chat execution to `/api/chat` and consumes server-sent events from that route.

### `/api/chat` is not static UI

`app/api/chat/route.ts` is explicitly a Node runtime route:

```ts
export const runtime = 'nodejs'
```

It owns responsibilities that cannot remain inside a static Tauri frontend:

- request validation for chat execution
- model/provider selection
- direct OpenAI and Anthropic provider calls
- provider secret access through environment variables
- standalone governance/evidence envelope creation
- SourceOS-mode task submission through the Superconscious adapter
- server-sent event framing for `meta`, `delta`, `done`, and `error`

Therefore Noetica is not yet statically exportable as a complete product while retaining live chat behavior.

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
    /chat execution transport
    SSE or equivalent streaming protocol
    provider secret access
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
| Chat execution request | `fetch('/api/chat')` in `AppShell` | No | Local service / SourceOS endpoint | Must become configurable service transport. |
| Chat SSE parsing | `readEventStream` in `AppShell` | Yes | Noetica UI | Keep parser; change endpoint source. |
| Provider calls | `lib/providers/openai.ts`, `lib/providers/anthropic.ts` | No | Local service / model-router/provider layer | Requires secrets and external network authority. |
| SourceOS task submission | `lib/superconscious/adapter.ts` via `/api/chat` | No | SourceOS / Agent Machine endpoint | Adapter should remain an interface, not UI authority. |
| CLI foreground server | `noetica start` | Not product UI | Operational local service/server mode | Must not be the primary desktop UX. |
| Tauri shell | `src-tauri/*` | Yes | Noetica desktop shell | Should eventually load static UI from export output. |

## Required next implementation shape

### 1. Introduce a transport boundary

Create a small client transport module for the UI:

```text
lib/client/noeticaTransport.ts
```

It should hide whether chat execution goes to:

- browser fallback `/api/chat`
- desktop local service, for example `http://127.0.0.1:<port>/chat`
- future Tauri command bridge
- SourceOS/Agent Machine endpoint

The UI should call the transport module, not hard-code `/api/chat`.

### 2. Preserve `/api/chat` only as browser fallback for now

Do not delete the route in the first static-boundary patch. Reclassify it as browser/dev fallback or transitional local-service code. Moving it all at once risks breaking the working path before the static UI is proven.

### 3. Add a static export probe after transport abstraction

Only after the UI no longer requires a bundled Next API route should `next.config.mjs` get a controlled static-export branch or script. The eventual shape should point Tauri at a static output directory rather than `../.next`.

Candidate future scripts:

```json
"build:web": "next build",
"build:static": "next build",
"tauri:build": "npm run tauri:icon && npm run build:static && tauri build"
```

The exact script names should be decided in the implementation PR.

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
- Do not move provider secrets into the UI.
- Do not make Noetica the durable provider/runtime authority.
- Do not start SourceOS route integration in this tranche.
- Do not make `noetica start` the primary desktop UX.
- Do not claim production packaging readiness.
