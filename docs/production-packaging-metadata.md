# Noetica Production Packaging Metadata

Status: Phase 1H packaging metadata tranche

## Purpose

Noetica now has a CI-proven static Tauri build path, but it does not yet have production packaging. This document defines the metadata and acceptance criteria required before Noetica can be treated as a signed desktop app artifact.

This tranche records packaging metadata requirements only. It does not enable Tauri bundling, signing, notarization, Linux packages, or update channels.

## Current build facts

```text
productName: Noetica
identifier: ai.noetica.app
static UI output: out
Tauri frontendDist: ../out
bundle.active: false
```

The current identifier is acceptable for feasibility. It must be reviewed before signing or public distribution.

## Target package split

```text
sourceos-linux/tap/noetica
  CLI, diagnostics, configuration, foreground operational mode, service lifecycle

sourceos-linux/tap/noetica-app
  native desktop app bundle / cask-style artifact
```

## Required metadata

### App identity

Required fields:

```text
productName
bundle identifier
version
publisher / team identity
copyright
license
support URL
update channel
```

Acceptance criteria:

- bundle identifier is stable before signing
- version source is deterministic
- app identity is the same across Tauri config, release notes, and package metadata
- support and issue-routing locations are documented

### Icon assets

The current transparent placeholder icon is not production-ready.

Required icon set:

```text
source vector asset
macOS ICNS
Windows ICO only if Windows packaging is later added
Linux PNG set: 16, 32, 48, 64, 128, 256, 512
512x512 and 1024x1024 marketing/export assets
```

Acceptance criteria:

- placeholder icon is removed from production bundle path
- generated icons are reproducible from source asset
- icon generation script records inputs and output paths
- CI verifies production icon files exist before packaging release jobs

### macOS signing and notarization

Required metadata:

```text
Apple team identifier
signing certificate label
hardened runtime setting
entitlements file path
notarization profile name
stapling requirement
```

Acceptance criteria:

- unsigned feasibility builds remain separate from release builds
- signing credentials are never committed
- release workflow uses CI secret references only
- notarization success is captured as release evidence
- stapled app artifact is verified before publication

### Linux desktop entry and package metadata

Required files:

```text
packaging/linux/ai.noetica.app.desktop
packaging/linux/ai.noetica.app.metainfo.xml
packaging/linux/icons/
```

Desktop entry requirements:

```text
Name=Noetica
Exec=noetica-app
Icon=ai.noetica.app
Terminal=false
Type=Application
Categories=Development;Utility;
StartupWMClass=Noetica
```

Acceptance criteria:

- desktop file validates with `desktop-file-validate`
- appstream metadata validates with `appstreamcli validate`
- Linux icon names match the desktop entry
- package metadata references the same app identifier as Tauri

### Provenance and SBOM

Required release evidence:

```text
source commit
build workflow run
Node dependency lockfile hash
Cargo lockfile hash
static UI artifact hash
Tauri bundle artifact hash
SBOM path
provenance attestation path
```

Acceptance criteria:

- release artifact can be tied back to a commit and workflow run
- SBOM includes Node and Rust dependency surfaces
- static UI output and native app bundle are hashed separately
- provenance is stored with the release artifact

### Update channel

No update channel is selected yet.

Allowed future choices:

```text
manual release download
Homebrew cask update
Tauri updater
SourceOS-managed update channel
```

Acceptance criteria:

- update channel is explicit before production release
- auto-update is not enabled accidentally
- update metadata is signed if automatic updates are introduced
- rollback behavior is documented

## Release gates

A production desktop app release must pass:

```text
npm run build:static
test -f out/index.html
cargo check --locked
npm run tauri:build:static
icon asset verification
signing verification
notarization verification, macOS only
Linux metadata validation, Linux only
SBOM generation
artifact hash/provenance capture
```

## Non-goals

- No production cask in this tranche.
- No signing implementation in this tranche.
- No notarization implementation in this tranche.
- No Linux package implementation in this tranche.
- No auto-update implementation in this tranche.
- No Electron fallback.

## Next implementation tranche

Add repository placeholders for packaging metadata paths without enabling production packaging:

```text
packaging/linux/
packaging/macos/
packaging/provenance/
```

Then add validation scripts for icon presence, Linux desktop metadata, and release evidence manifests.
