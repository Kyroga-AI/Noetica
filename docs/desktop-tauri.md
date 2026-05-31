# Noetica Tauri Desktop Shell

Status: Phase 1H feasibility shell

This is the first Tauri-first desktop hardening tranche. It proves that Noetica can open a native desktop window without treating the browser as the primary product experience.

## Commands

```bash
npm run tauri:dev
npm run tauri:build
```

Both commands first run `npm run tauri:icon`, which materializes a minimal placeholder at `src-tauri/icons/icon.png` for Tauri context generation.

## Current boundary

This tranche intentionally uses the existing Next.js development server as the Tauri dev URL:

```text
http://127.0.0.1:3737
```

That is a feasibility bridge, not the final product architecture.

## Feasibility icon

Tauri context generation may resolve `src-tauri/icons/icon.png` even when production bundling is disabled. This tranche therefore creates a minimal transparent placeholder icon before `tauri dev` and `tauri build`.

The placeholder is not a production asset. Real app icons, ICNS/ICO generation, signing, notarization, cask/app packaging, and branding belong to the packaging hardening tranche.

## Next tranche

The next tranche must decide whether Noetica can be built as a Tauri-compatible static UI. If not, server/API authority must move behind a local service or SourceOS/Agent Machine-owned endpoint.

Target split:

```text
noetica app        primary desktop app UX
noetica start      operational foreground local service/server mode
noetica open       web fallback
noetica service    OS-native background service lifecycle
noetica dev        developer-only Next dev server
```

## Non-goals

- No SourceOS routing changes in this tranche.
- No Agent Machine readiness changes in this tranche.
- No Electron fallback in this tranche.
- No claim that this is production-grade packaging yet.
