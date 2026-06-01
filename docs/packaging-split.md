# Noetica Packaging Split Decision

Status: Phase 1H packaging planning artifact

## Purpose

Noetica now has:

- a Tauri desktop shell
- static UI build output under `out`
- product CLI command semantics
- a service boundary contract
- a visible runtime status surface

The remaining packaging question is whether Homebrew should ship Noetica as one artifact or split CLI/service tooling from the desktop application bundle.

## Decision

Use a split packaging model.

```text
sourceos-linux/tap/noetica
  CLI, configuration, diagnostics, foreground operational server mode, service lifecycle commands

sourceos-linux/tap/noetica-app
  native desktop app bundle / cask-style artifact
```

This decision does not require implementing the cask in this tranche. It records the target packaging boundary so future work does not fold desktop packaging concerns into the CLI formula.

Detailed production packaging metadata requirements are maintained in:

```text
docs/production-packaging-metadata.md
```

## Why split

### Different lifecycle semantics

The CLI and operational service path are command-line tools. They are appropriate for a formula-style install.

The desktop app has a native app lifecycle: bundle identity, app icon set, window lifecycle, signing, notarization, update channel, and OS desktop integration. These belong in an app/cask-style artifact.

### Different trust and release requirements

The CLI can be validated as scripts, Node dependencies, static output, and service files.

The desktop app requires a stronger packaging chain:

- real icon set
- bundle identifier discipline
- macOS signing path
- macOS notarization path
- Linux desktop entry and package metadata
- provenance/SBOM for bundled assets
- update channel decision

### Cleaner user semantics

`noetica` should remain the operational and diagnostic command surface.

`noetica app` is the current product entry command during hardening, but final desktop installation should be explicit as an app artifact rather than hidden inside server/start behavior.

## Current implementation state

| Surface | Current state | Target package |
|---|---|---|
| `noetica doctor` | implemented | `noetica` formula |
| `noetica smoke` | implemented | `noetica` formula |
| `noetica configure` | implemented | `noetica` formula |
| `noetica start` | foreground operational mode | `noetica` formula |
| `noetica service` | OS-native lifecycle command surface | `noetica` formula |
| `noetica web` / `open` | browser fallback | `noetica` formula |
| `noetica dev` | developer-only Next dev server | source checkout / formula dev path |
| `noetica app` | Tauri development shell launcher | bridge until app artifact exists |
| Tauri static build | CI-proven against `out` | `noetica-app` artifact |

## Homebrew policy

Do not use `brew services` as canonical supervision.

The canonical background lifecycle remains:

```text
noetica service install
noetica service start
noetica service status
noetica service stop
noetica service uninstall
```

Homebrew should install tooling and app artifacts. Noetica should own its service lifecycle semantics.

## Packaging acceptance criteria

### CLI/formula artifact

The formula path is acceptable when it can install and validate:

- `noetica version`
- `noetica doctor --json`
- `noetica smoke --dry-run`
- `noetica configure`
- `noetica start`
- `noetica web`
- `noetica service ...`

### Desktop app artifact

The app/cask path is acceptable only when it has:

- production icon assets
- stable bundle identifier
- static UI bundle generated from `out`
- native app bundle produced by Tauri
- macOS signing plan
- macOS notarization plan
- Linux package/desktop-entry plan
- provenance/SBOM plan
- update-channel decision

## Near-term implementation path

1. Keep `sourceos-linux/tap/noetica` as the CLI/service formula.
2. Keep `noetica app` as the development bridge into Tauri while Phase 1H continues.
3. Add production packaging metadata in a later tranche.
4. Introduce `sourceos-linux/tap/noetica-app` only when the app bundle is ready for real desktop packaging.

## Non-goals for this tranche

- No cask implementation.
- No signing or notarization implementation.
- No Linux package implementation.
- No update channel implementation.
- No service daemon implementation.
- No Electron fallback.

## Next tranche

Add repository placeholders for packaging metadata paths and validation scripts for icon presence, Linux desktop metadata, and release evidence manifests.
