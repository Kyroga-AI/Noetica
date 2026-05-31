# Noetica Release Artifact

Status: Phase 1

Noetica uses a release artifact so Homebrew can install a real workstation payload instead of inventing lifecycle behavior in the formula.

Build the artifact:

```bash
npm run release:artifact
```

The command produces:

```text
dist/release/noetica-0.1.0-node.tar.gz
dist/release/noetica-0.1.0-node.tar.gz.sha256
dist/release/noetica-0.1.0-node.tar.gz.receipt.json
```

The unpacked artifact includes:

- built Next.js app output;
- `cli/noetica.mjs`;
- config and service adapter modules;
- app, component, config, lib, and doc sources needed by the runtime;
- `NOETICA_RELEASE.json` manifest;
- `README.install.txt` operator note.

## Artifact posture

This is a Node/Next workstation payload for Phase 1. It is not a desktop app bundle and not a SourceOS image.

The Homebrew formula should install this artifact, expose `noetica`, and leave lifecycle control to the Noetica CLI.

## Validation

The validation workflow checks that the artifact, checksum, and receipt are produced.

The release receipt records:

- artifact name;
- SHA-256 digest;
- version;
- creation timestamp;
- build validation command;
- package layout profile.

## Boundaries

- No Homebrew formula is defined in this repository.
- Homebrew service supervision is not used.
- Generated service definitions remain under `noetica service ...`.
- Prophet Mesh is not required for artifact creation.
