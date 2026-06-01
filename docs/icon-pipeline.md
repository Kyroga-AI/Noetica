# Noetica Production Icon Pipeline

Status: Phase 1H packaging metadata tranche

## Purpose

The desktop app needs a reproducible icon pipeline before production packaging. This tranche establishes the manifest, source asset, deterministic SVG generation scaffold, and validation surface without claiming PNG or ICNS production assets are complete.

## Files

```text
packaging/icons/icon-manifest.json
packaging/icons/source/noetica-icon.source.svg
scripts/generate-icons.mjs
```

The source SVG is a placeholder and must be replaced before production release.

## Current generation

```bash
npm run icons:generate
```

The generator reads the icon manifest and source SVG, then writes deterministic SVG outputs for declared Linux and marketing sizes.

Generated SVG outputs are validated by:

```bash
npm run packaging:validate
```

`packaging:validate` now runs `icons:generate` before validation so CI proves the generated SVG path on every PR.

## Current validation

`npm run packaging:validate` checks:

- icon manifest schema
- app identifier
- source asset path
- placeholder policy
- generated Linux SVG output sizes
- generated marketing SVG output sizes
- required Linux PNG output sizes remain pending raster generation
- macOS ICNS output path remains pending generation
- source SVG presence

## Generated SVG outputs

```text
packaging/icons/linux/16x16/apps/ai.noetica.app.svg
packaging/icons/linux/32x32/apps/ai.noetica.app.svg
packaging/icons/linux/48x48/apps/ai.noetica.app.svg
packaging/icons/linux/64x64/apps/ai.noetica.app.svg
packaging/icons/linux/128x128/apps/ai.noetica.app.svg
packaging/icons/linux/256x256/apps/ai.noetica.app.svg
packaging/icons/linux/512x512/apps/ai.noetica.app.svg
packaging/icons/marketing/noetica-512.svg
packaging/icons/marketing/noetica-1024.svg
```

## Pending raster outputs

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
- No raster conversion dependency added in this tranche.
- No production branding claim.
- No signing or notarization.
- No app/cask release.

## Next tranche

Add a raster/vector conversion tool decision and generate PNG/ICNS artifacts in release workflow scope.
