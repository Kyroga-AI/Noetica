# Noetica Runtime Control

Status: Phase 1

Noetica supports foreground runtime mode before service registration. This is the required baseline for macOS and Linux workstation use.

## Foreground start

Start Noetica directly:

```bash
noetica start
```

`noetica start` reads the SourceOS-aligned config at:

```text
~/.config/sourceos/noetica/config.json
```

When no config exists, it uses the default local runtime target:

```text
http://127.0.0.1:3737
```

The command passes the configured host and port to Next.js unless explicit pass-through flags are supplied.

Override the port for one run:

```bash
noetica start -- --port 3740
```

Override the hostname for one run:

```bash
noetica start -- --hostname 127.0.0.1
```

## Port checks

Before starting, Noetica probes the configured host and port. If the port is already occupied and the user did not pass an explicit port override, the start command refuses with a structured `NoeticaStartRefused` response.

Inspect readiness:

```bash
noetica doctor
noetica doctor --json
```

Run dry-run smoke:

```bash
noetica smoke --dry-run
```

Both commands include runtime host, port, and port-availability information.

## Open local UI

Open the configured Noetica URL:

```bash
noetica open
```

`NOETICA_URL` can override the configured URL for one invocation:

```bash
NOETICA_URL=http://127.0.0.1:3740 noetica open
```

## Service mode

Service mode remains a later Phase 1 step. The foreground command is the target that future macOS LaunchAgent and Linux systemd user units should call.
