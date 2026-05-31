# Noetica Provider Configuration

Status: Phase 1

Noetica stores user configuration under the SourceOS-aligned path:

```text
~/.config/sourceos/noetica/config.json
```

Create the default config:

```bash
noetica configure
```

Overwrite the default config deliberately:

```bash
noetica configure --force
```

## Secret policy

Noetica does not write raw provider secrets to config by default. Provider routes reference environment variables such as `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, and `PROPHET_MESH_API_KEY`.

Later phases may add macOS Keychain, Linux Secret Service, SourceOS vault, or managed identity support.

## Phase 1 provider routes

The default config includes:

- `openai-compatible` — external OpenAI-compatible API route, disabled by default.
- `anthropic` — external Anthropic/Claude route, disabled by default.
- `sourceos` — local SourceOS route placeholder, disabled by default.
- `agent-machine` — local Agent Machine route placeholder, disabled by default.
- `prophet-mesh` — future hosted Prophet Mesh route, disabled and marked deferred.

Phase 1 validates the install path and provider abstraction against external test providers first. Prophet Mesh is not required for Phase 1.

## Diagnostics

Inspect readiness:

```bash
noetica doctor
noetica doctor --json
```

Run dry-run smoke:

```bash
noetica smoke --dry-run
```

Run provider smoke after enabling a provider route and exporting the referenced key:

```bash
noetica smoke --provider openai-compatible
noetica smoke --provider anthropic
```

Provider smoke is explicit. Missing keys remain non-fatal for `doctor` and `smoke --dry-run`, but an explicitly requested provider smoke fails closed when the provider is disabled, missing, deferred, unsupported, or missing its configured credential environment variable.

## Provider smoke behavior

`openai-compatible` probes `GET /models` against the configured base URL.

`anthropic` probes `GET /v1/models` against the configured base URL using `anthropic-version: 2023-06-01` and `x-api-key`.

Provider smoke output redacts URL query secrets, summarizes returned model lists, and does not print provider API keys.

Missing provider keys, missing Agent Machine, and missing Prophet Mesh are non-fatal in Phase 1 unless the user explicitly asks to smoke that provider.
