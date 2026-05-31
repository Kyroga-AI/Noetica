# Noetica Productization Ledger

Status: current as of 2026-05-31.

## Canonical baseline

`main` is the authoritative Noetica productization baseline.

Noetica remains the governed chat/product surface. It must not become the policy authority, memory authority, execution evidence authority, replay authority, or AgentTerm replacement.

## Completed substrate integration

The SourceOS interaction substrate is already integrated into Noetica:

- Noetica emits `SourceOSInteractionEvent` from the chat lifecycle.
- Noetica vendors generated SourceOS interaction TypeScript contracts.
- Noetica has contract-sync automation against `SourceOS-Linux/sourceos-spec`.
- Noetica points to the canonical SourceOS interaction reference flow.

The canonical schema, generated contract artifacts, and reference flow remain owned by `SourceOS-Linux/sourceos-spec`.

## Completed workstation-install integration

Phase 1 workstation-install work was collapsed and merged through PR #28 after the stacked Phase 1 PR ancestry became stale after the PR #21 squash merge.

Captured capabilities:

- CLI lifecycle wrapper.
- SourceOS-aligned config/provider model.
- Provider smoke checks.
- Foreground start/open hardening and port probing.
- OS-native service adapter surface.
- Deterministic release artifact layout.
- Runtime, service, provider, and release documentation.
- CI hooks for CLI doctor/smoke and release artifact checks.

The older stacked PRs #22 through #27 are historical implementation tranches. They are not the forward path and should remain closed once their salvage audit comments are posted.

## Completed desktop feasibility integration

Phase 1H Tauri desktop feasibility work was merged through PR #30.

Captured capabilities:

- `src-tauri` binary shell.
- Minimal Tauri capability file with no extra permissions.
- Tauri command surface for desktop status.
- Tauri dev/build npm scripts.
- Feasibility icon materializer for Tauri context generation.
- macOS CI jobs for Tauri Rust check and feasibility build.
- Desktop feasibility documentation.

Boundary: this is a feasibility shell, not production packaging. It intentionally uses the existing local Next URL as a bridge while the next tranche decides the final static UI versus local service/API authority split.

## Deferred work

Do not start these until the desktop lifecycle is stable:

- Noetica to AgentTerm runtime event bridge.
- Policy Fabric authority wiring.
- Agent Registry identity/grant attachment.
- Memory Mesh reference wiring.
- SocioSphere manifest/lock materialization.
- Production desktop packaging, signing, notarization, and app icon set.
- `sourceos-contracts` package extraction.

## Current forward path

The next tranche should optimize buildability and product-grade local lifecycle:

1. Verify `main` builds the web application and Tauri feasibility shell.
2. Address open CodeQL/workflow hygiene findings that affect trusted release posture.
3. Decide whether Noetica can become a Tauri-compatible static UI or requires a local service/API boundary.
4. Convert `noetica app` into the primary desktop UX while keeping `noetica start` as operational foreground/server mode.
