# SourceOS Interaction Event Export Path

Status: proposed implementation for `Noetica#49`

## Decision

The runtime bridge keeps two export-path modes:

### Development

Deterministic repository-local path:

```text
.noetica/events/
```

This remains the default for development, fixtures, CI validation, and replay-oriented workflows.

### Production

Production export paths are local workstation state locations.

macOS:

```text
~/Library/Application Support/Noetica/sourceos/events/
```

Linux:

```text
$XDG_STATE_HOME/noetica/sourceos/events/
```

Fallback when `XDG_STATE_HOME` is unset:

```text
~/.local/state/noetica/sourceos/events/
```

## Override

Explicit override:

```text
NOETICA_SOURCEOS_EVENT_DIR=/path/to/events
```

This always wins over development/production defaults.

## Rationale

- Keeps development exports deterministic.
- Keeps workstation exports outside the repository tree.
- Does not imply durable system-of-record authority.
- Remains compatible with future OpsHistory decisions.
- Keeps AgentTerm opt-in and pull/import oriented.

## Non-goals

- No live event stream.
- No endpoint serving.
- No OpsHistory durability decision.
- No Policy Fabric, Agent Registry, or Memory Mesh ownership changes.
