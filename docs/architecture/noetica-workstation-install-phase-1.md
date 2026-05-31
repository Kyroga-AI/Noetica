# Noetica Workstation Install Phase 1

Status: proposed
Issue: #20
Scope: Noetica install, lifecycle, provider test routes, and OS-native service control

## Purpose

Phase 1 makes Noetica installable and runnable as a first-class workstation product on macOS and Linux while preserving SourceOS/Linux as the long-term operating-system substrate.

The immediate target is a user/operator experience where a clean workstation can install Noetica, configure an external test provider, run diagnostics, start the app in foreground, and optionally install an OS-native user service.

Homebrew is an installer and distribution path. It is not the service supervision model.

## Current repository baseline

Noetica already has the governed chat surface, provider boundary, governance trail, SourceOS adapter boundary, and SourceOSInteractionEvent lifecycle emission work in place. The repository has also moved toward canonical SourceOS interaction contracts through vendored generated SourceOS interaction types and contract-sync checks.

Phase 1 therefore focuses on productizing the workstation lifecycle rather than redefining the interaction substrate.

## Design principles

1. Noetica must run in foreground mode without installing a daemon or service.
2. Long-running service mode must use OS-native control planes.
3. Homebrew may install Noetica, but it must not be the canonical runtime supervisor.
4. macOS and Linux are both first-class Phase 1 targets.
5. SourceOS/Linux remains the long-term operating-system distribution path.
6. Agent Machine is the local runtime substrate, but Phase 1 must tolerate Agent Machine being absent or bootstrap-only.
7. AgentTerm is not required for Phase 1.
8. Prophet Mesh is deferred until after Noetica's install and provider abstraction are proven against external test providers.
9. Noetica must not store raw provider secrets in its config by default.
10. Noetica must report missing optional infrastructure clearly instead of failing ambiguously.

## Install model

The desired installer path is:

```bash
brew install SourceOS-Linux/tap/noetica
```

The installed package must provide a `noetica` command.

Homebrew may install release artifacts, CLI wrappers, templates, static assets, documentation, and default config templates. It must not be relied on as the service manager.

## Runtime modes

### Foreground mode

Foreground mode is the required baseline.

```bash
noetica start
```

This mode starts Noetica directly in the current terminal, emits logs to stdout/stderr, and requires no service registration. This is the correct default for development, debugging, and first-run validation.

### OS-native service mode

Service mode is optional and managed by Noetica through platform adapters.

```bash
noetica service install
noetica service start
noetica service status
noetica service stop
noetica service uninstall
```

On macOS, Noetica must generate and manage a user LaunchAgent with `launchctl`.

On Linux, Noetica must generate and manage a `systemd --user` unit or SourceOS-compatible user service unit. Quadlet may be introduced when the runtime is containerized.

`brew services` is not the canonical service path.

## CLI command contract

Phase 1 should introduce or stabilize these commands:

```bash
noetica version
noetica doctor
noetica configure
noetica start
noetica open
noetica smoke
noetica service install
noetica service start
noetica service status
noetica service stop
noetica service uninstall
```

### `noetica version`

Prints the Noetica version, build metadata, source commit if available, and installation root.

### `noetica doctor`

Reports local readiness. It must support human-readable output and JSON output.

Required checks:

- Noetica installation root exists.
- Node runtime is available or bundled runtime is available.
- App build is present.
- Config file exists and validates, or can be created.
- Configured port is available or already owned by Noetica.
- External provider routes are configured or explicitly absent.
- Referenced provider credential environment variables are present or absent.
- Agent Machine is installed, absent, bootstrap-only, available, or unknown.
- SourceOS route is configured, disabled, or unavailable.
- Prophet Mesh is not configured or deferred.

Missing external provider keys, missing Agent Machine, and missing Prophet Mesh are warnings in Phase 1, not fatal errors.

### `noetica configure`

Creates or updates user config without writing raw provider secrets by default.

### `noetica start`

Runs Noetica in foreground mode.

### `noetica open`

Opens the configured local Noetica URL in the default browser.

### `noetica smoke`

Runs a dry-run smoke check by default and optional provider-specific smoke checks when credentials are present.

Required forms:

```bash
noetica smoke --dry-run
noetica smoke --provider openai-compatible
noetica smoke --provider anthropic
```

## Config discipline

Default user config path:

```text
~/.config/sourceos/noetica/config.json
```

Default user state/log paths should also live under SourceOS-aligned user paths, not under arbitrary clone or build directories.

Initial config shape:

```json
{
  "schemaVersion": "noetica.config.v0.1",
  "server": {
    "host": "127.0.0.1",
    "port": 3737
  },
  "providers": {
    "default": "openai-compatible",
    "routes": [
      {
        "id": "openai-compatible",
        "kind": "openai-compatible",
        "baseUrl": "https://api.openai.com/v1",
        "apiKeyEnv": "OPENAI_API_KEY",
        "enabled": false
      },
      {
        "id": "anthropic",
        "kind": "anthropic",
        "baseUrl": "https://api.anthropic.com",
        "apiKeyEnv": "ANTHROPIC_API_KEY",
        "enabled": false
      },
      {
        "id": "sourceos",
        "kind": "sourceos",
        "baseUrl": "http://127.0.0.1:3741",
        "enabled": false
      },
      {
        "id": "agent-machine",
        "kind": "agent-machine",
        "baseUrl": "http://127.0.0.1:3751",
        "enabled": false
      },
      {
        "id": "prophet-mesh",
        "kind": "openai-compatible",
        "baseUrl": "https://models.socioprophet.ai/v1",
        "apiKeyEnv": "PROPHET_MESH_API_KEY",
        "enabled": false,
        "phase": "deferred"
      }
    ]
  }
}
```

Raw provider secrets must not be written to the config by default. Phase 1 uses environment-variable references. Later phases may add macOS Keychain, Linux Secret Service, SourceOS vault, or managed identity bindings.

## Provider posture

Phase 1 validates Noetica against external test providers first:

- OpenAI-compatible provider route.
- Anthropic provider route.
- Optional arbitrary OpenAI-compatible base URL.

These are test routes for proving installation, lifecycle, provider abstraction, governance trail, and smoke behavior.

Prophet Mesh is explicitly deferred. It must not be required for Phase 1 completion.

Agent Machine local provider service is also deferred. Phase 1 may detect Agent Machine but must not require live local activation.

## Agent Machine relationship

Agent Machine is the local runtime substrate for future local providers and local workers. Phase 1 only needs to detect and report its state.

Allowed Phase 1 states:

- `not_found`
- `bootstrap_only`
- `available`
- `unknown`

Noetica must not fail because Agent Machine is absent, bootstrap-only, or not serving a provider route.

## AgentTerm relationship

AgentTerm is out of the default Phase 1 install path.

Noetica may absorb relevant operator-facing lifecycle and governance-trace UX. Terminal-native Matrix/ChatOps remains separate unless reintroduced deliberately in a later phase.

## Service adapters

### macOS LaunchAgent

`noetica service install` on macOS should write a user LaunchAgent plist under:

```text
~/Library/LaunchAgents/ai.noetica.app.plist
```

The plist must call the installed `noetica start` or an equivalent internal start target. It must not inline provider secrets.

### Linux systemd user unit

`noetica service install` on Linux should write a user unit under:

```text
~/.config/systemd/user/noetica.service
```

The unit must call the installed `noetica start` or an equivalent internal start target. It must not inline provider secrets.

SourceOS-specific service integration can extend this path later without changing the CLI contract.

## Release artifact posture

The Homebrew formula should package a real Noetica release artifact rather than inventing lifecycle behavior in the formula.

The release artifact should include:

- built Noetica app;
- `noetica` CLI;
- service templates or generators;
- config template;
- doctor/smoke implementation;
- installation metadata;
- release evidence metadata where available.

## Phase 1 non-goals

- Do not deploy Prophet Mesh.
- Do not require live Agent Machine provider activation.
- Do not require AgentTerm.
- Do not use Homebrew services as the canonical service supervisor.
- Do not require Memory Mesh writeback.
- Do not require full Policy Fabric admission for external-provider smoke.
- Do not require AgentPlane run evidence for ordinary external-provider chat smoke.
- Do not store raw provider secrets in config by default.
- Do not ship desktop packaging yet.

## Acceptance criteria

Phase 1 is complete when:

1. `brew install SourceOS-Linux/tap/noetica` installs Noetica and exposes `noetica`.
2. `noetica version` works after install.
3. `noetica configure` creates a valid SourceOS-aligned user config.
4. `noetica doctor` reports local readiness with clear warnings and no false fatal errors.
5. `noetica doctor --json` emits machine-readable status.
6. `noetica start` runs Noetica in foreground mode.
7. `noetica open` opens the configured local UI URL.
8. `noetica smoke --dry-run` succeeds without external provider credentials.
9. Provider smoke checks fail clearly when credentials are missing and succeed when a valid configured provider is present.
10. `noetica service install/start/status/stop/uninstall` uses `launchctl` on macOS and `systemd --user` or SourceOS-compatible service control on Linux.
11. Agent Machine is detected and reported but not required to be live.
12. Prophet Mesh is reported as deferred or not configured.
13. AgentTerm is not installed or required by default.
14. The Homebrew formula test validates the installed CLI.
15. Documentation matches actual commands and failure modes.

## Implementation order

1. Add this architecture contract.
2. Add CLI lifecycle wrapper.
3. Add config/provider model.
4. Add doctor/smoke checks.
5. Add OS-native service adapters.
6. Add release artifact build.
7. Add Homebrew tap formula.
8. Add install/operator docs.

## Open decisions

1. Whether the first release artifact should be a prebuilt Next standalone artifact or a source-plus-build artifact.
2. Whether the Homebrew formula should hard-depend on `agent-machine` in Phase 1 or merely recommend it.
3. Whether the first CLI implementation should be plain Node, shell plus Node, or a small compiled wrapper.
4. Whether `prophet-mesh` should appear in default config as disabled/deferred or only in documentation until the hosted service exists.
