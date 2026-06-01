# Noetica Production Icon Pipeline

Status: Phase 1H packaging metadata tranche

## Purpose

The desktop app needs a reproducible icon pipeline before production packaging. This tranche establishes the manifest and validation surface without claiming generated production icons are complete.

## Files

```text
packaging/icons/icon-manifest.json
packaging/icons/source/noetica-icon.source.svg
```

The source SVG is a placeholder and must be replaced before production release.

## Current validation

`npm run packaging:validate` now checks:

- icon manifest schema
- app identifier
- source asset path
- placeholder policy
- required Linux PNG output sizes
- macOS ICNS output path
- marketing asset output sizes
- source SVG presence

Generated icon outputs remain marked as `pending_generation`.

## Required generated outputs

```text
packaging/icons/macos/noetica.icns
packaging/icons/linux/16x16/apps/ai.noetica.app.png
packaging/icons/linux/32x32/apps/ai.noetica.app.png
packaging/icons/linux/48x48/apps/ai.noetica.app.png
packaging/icons/linux/64x64/apps/ai.noetica.app.png
packaging/icons/linux/128x128/apps/ai.noetica.app.png
packaging/icons/linux/256x256/apps/ai.noetica.app.png
packaging/icons/linux/512x512/apps/ai.noetica.app.png
packaging/icons/marketing/noetica-512.png
packaging/icons/marketing/noetica-1024.png
```

## Non-goals

- No generated PNG/ICNS assets in this tranche.
- No production branding claim.
- No signing or notarization.
- No app/cask release.

## Next tranche

Add a deterministic icon generation script and update the validator so production outputs can move from `pending_generation` to generated artifacts.
