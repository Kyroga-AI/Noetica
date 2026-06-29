# Noetica / HellGraph Deployment Surface v0.1

## Status

Operational DevOps specification.

This document defines Noetica as the primary deployment surface for the current HellGraph stack.

## Current repository role

Noetica is the governed chat and desktop/application surface for the SocioProphet / SourceOS stack.

It owns:

- user-facing chat surface
- standalone provider routing
- SourceOS adapter boundary
- governance trail display
- steering UX
- model registry UI/control surface
- local Agent Machine bridge
- Tauri desktop packaging
- static frontend export used by the desktop bundle

It does not own final authority for:

- durable memory
- model routing policy
- policy admission
- evidence authority
- long-term graph state

Those are delegated to the wider SourceOS/SocioProphet substrate.

## HellGraph role in Noetica

Noetica depends directly on HellGraph:

```json
"@socioprophet/hellgraph": "github:SocioProphet/hellgraph#main"
```

This makes HellGraph part of the Noetica runtime/deployment surface. The dependency is currently source-of-truth dynamic against `main`, not pinned to a tag or commit.

## Current integration points

### Chat API route

`app/api/chat/route.ts` imports HellGraph ingestion functions:

```ts
import { ingestInteraction, ingestMessage, ingestMemory } from '@socioprophet/hellgraph'
```

This means the chat surface can already write interaction, message, and memory artifacts into the HellGraph substrate.

### Agent Machine

`agent-machine/package.json` also depends on:

```json
"@socioprophet/hellgraph": "github:SocioProphet/hellgraph#main"
```

The Agent Machine is therefore a second runtime path for HellGraph consumption.

### Desktop packaging

`src-tauri/tauri.conf.json` builds the desktop frontend through:

```text
beforeBuildCommand: npm run build:static
frontendDist: ../out
```

Therefore the deployable desktop artifact depends on:

- successful root install
- successful static Next export
- HellGraph package resolution/build
- Agent Machine sidecar binary if building the full bundle

## Deployment modes

### Mode A — Web/dev shell

```text
npm ci
npm run typecheck
npm run build
npm run dev
```

Purpose:

- fast UI validation
- provider routing validation
- SourceOS adapter validation
- HellGraph ingestion integration checks

### Mode B — Static desktop frontend

```text
npm ci
npm run build:static
npm run build:static:probe
```

Purpose:

- validates Tauri frontend export
- catches static export failures before desktop packaging

### Mode C — Agent Machine runtime

```text
cd agent-machine
npm ci
npm run build
npm test
```

Purpose:

- validates local runtime service
- validates HellGraph dependency from the backend/sidecar path

### Mode D — Tauri desktop bundle

```text
npm ci
npm run tauri:build:static
```

Purpose:

- produces local desktop app bundle
- validates static frontend and Tauri packaging

### Mode E — Full desktop bundle with Agent Machine sidecar

```text
npm ci
npm run agent-machine:build:binary
npm run tauri:build:full
```

Purpose:

- validates production-style desktop bundle
- injects Agent Machine sidecar config
- produces the highest-fidelity local artifact

## CI requirements

The minimum Noetica CI must check:

```bash
HUSKY=0 npm ci
npm run typecheck
npm run build:static
npm run build:static:probe
cd agent-machine && npm ci && npm run build && npm test
```

Optional later gates:

```bash
npm run packaging:validate
npm run cli:doctor
npm run cli:smoke
npm run sourceos:events:path:check
npm run sourceos:events:risk-refs:check
npm run risk:validate-fixtures
npm run risk:validate-counterfactual
```

Do not add the full Tauri build to required CI until the runner image has the required native Linux/macOS dependencies and signing constraints are documented.

## Release blockers

### 1. HellGraph dependency is pinned to `main`

Current behavior:

```json
"@socioprophet/hellgraph": "github:SocioProphet/hellgraph#main"
```

Risk:

- Noetica deployments are not reproducible.
- A HellGraph breaking change can break Noetica without a Noetica PR.

Required resolution:

- pin to a HellGraph tag, release branch, or commit SHA for production builds
- keep `main` only for explicit development channels

### 2. package-lock version drift

`package.json` and `package-lock.json` versions must be kept aligned.

Risk:

- CI and install metadata become ambiguous.
- release/version automation cannot trust package metadata.

### 3. Noetica CI must validate HellGraph resolution

Because Noetica imports HellGraph directly, CI must fail if the Git dependency cannot build or resolve.

### 4. Static export is a deploy gate

Tauri uses the static `out` directory. `build:static` and the static probe must be treated as deployment gates.

### 5. Agent Machine is part of the deployment surface

Agent Machine is not optional for the full local product. It must have its own build/test gate.

## Recommended branch model

Use three lanes:

```text
main
  stable development integration

deployment/noetica-desktop
  release-candidate desktop packaging lane

dependencies/hellgraph-pin-<version>
  explicit HellGraph pin/reproducibility updates
```

## Recommended artifact model

Artifacts to produce in later CI/CD:

- static web export archive
- Tauri desktop app bundle
- Agent Machine binary
- SourceOS interaction event fixture archive
- HellGraph ingestion smoke fixture
- deployment manifest
- SBOM
- checksum manifest

## Immediate DevOps backlog

1. Add GitHub Actions CI for root Next/static build and Agent Machine build/test.
2. Add a HellGraph dependency pinning policy.
3. Add a static export smoke artifact.
4. Add an Agent Machine smoke artifact.
5. Add HellGraph ingestion smoke tests using `ingestInteraction`, `ingestMessage`, and `ingestMemory`.
6. Add deployment-channel docs for dev, static desktop, full desktop, and SourceOS mode.
7. Add release checklist for Tauri packaging.

## Bottom line

Noetica is the prime deployment surface. HellGraph is already in the runtime dependency chain. The DevOps path is therefore:

```text
HellGraph feature/conformance branch
  -> Noetica dependency pin or integration branch
  -> Noetica static build
  -> Agent Machine build/test
  -> Tauri desktop package
  -> SourceOS/Noetica deployment artifact
```

The first operational target is not full cloud deployment. It is a reproducible local desktop/web deployment where Noetica consumes a pinned HellGraph build, static export passes, Agent Machine passes, and Tauri packaging has a known artifact path.
