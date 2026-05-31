# Noetica CLI Product Semantics

Status: Phase 1H desktop hardening tranche

## Purpose

Noetica now has a static Tauri build path and a local service boundary contract. The CLI must stop presenting raw browser/dev-server behavior as the primary product surface.

## Command contract

```text
noetica app        primary desktop app UX
noetica web        browser fallback
noetica open       alias for web
noetica dev        developer-only Next dev server
noetica start      foreground operational service/server mode
noetica service    OS-native service lifecycle commands
```

## Semantics

### `noetica app`

Launches the native desktop shell through the Tauri development path for this phase.

Current implementation:

```text
npm run tauri:dev
```

This is the primary product command, but it is still a development shell until packaging/signing/cask work is completed.

### `noetica web`

Opens the configured browser fallback URL.

`noetica open` remains available as an alias for compatibility.

### `noetica dev`

Starts the developer-only Next dev server and is the only command that should be treated as raw Next development output.

### `noetica start`

Starts the foreground operational service/server mode. This preserves the old working path but is no longer the primary user-facing UX.

### `noetica service`

Keeps the OS-native lifecycle command surface:

```text
install | start | status | stop | uninstall
```

Do not replace this with Homebrew service supervision as the canonical lifecycle.

## Non-goals

- No production desktop packaging in this tranche.
- No SourceOS route integration.
- No Agent Machine handshake.
- No provider/runtime migration.
- No Electron fallback.

## Next tranche

Add a visible UI status surface that reads the service status contract and shows:

```text
Mode: Desktop / Static UI
Runtime: Browser fallback or local service
Provider: configured / missing / deferred
SourceOS route: disabled / deferred / ready
Agent Machine: not detected / ready
Prophet Mesh: deferred
```
