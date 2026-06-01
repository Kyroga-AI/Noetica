# Noetica Tauri Desktop Shell

Status: Phase 1H static desktop shell

Noetica now has a Tauri-first desktop shell with a CI-proven static UI build path. The desktop build uses the exported static UI bundle rather than treating the browser/dev server as the production desktop artifact.

## Commands

```bash
npm run tauri:dev
npm run tauri:build
npm run tauri:build:static
```

All Tauri commands first run `npm run tauri:icon`, which materializes a minimal placeholder at `src-tauri/icons/icon.png` for Tauri context generation.

## Current boundary

Development mode still uses the Next.js development server as the Tauri dev URL:

```text
http://127.0.0.1:3737
```

Build mode uses static output:

```text
out/index.html
```

The static desktop shell is real. Runtime chat/steering authority remains behind fallback service endpoints until a local service, SourceOS endpoint, Agent Machine endpoint, or model-router boundary replaces those routes.

## Feasibility icon

Tauri context generation may resolve `src-tauri/icons/icon.png` even when production bundling is disabled. This tranche therefore creates a minimal transparent placeholder icon before Tauri commands.

The placeholder is not a production asset. Real app icons, ICNS/ICO generation, signing, notarization, cask/app packaging, and branding belong to the packaging hardening tranche.

## Packaging split

Packaging is split by responsibility:

```text
sourceos-linux/tap/noetica
  CLI, diagnostics, configuration, foreground service/server mode, service lifecycle commands

sourceos-linux/tap/noetica-app
  native desktop app bundle / cask-style artifact
```

`noetica app` remains the current desktop bridge while hardening continues. It should not be confused with a final signed/notarized app artifact.

## Next tranche

The next product tranche should add onboarding/remediation states for missing or deferred runtime capabilities.

## Non-goals

- No SourceOS routing changes in this tranche.
- No Agent Machine readiness changes in this tranche.
- No Electron fallback in this tranche.
- No claim that this is production-grade packaging yet.
