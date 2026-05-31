# Noetica Service Control

Status: Phase 1

Noetica uses Homebrew as an installer path, not as the canonical service supervisor.

Long-running service mode is managed by OS-native controls through the Noetica CLI:

```bash
noetica service install
noetica service start
noetica service status
noetica service stop
noetica service uninstall
```

## macOS

On macOS, Noetica writes a user LaunchAgent at:

```text
~/Library/LaunchAgents/ai.noetica.app.plist
```

The LaunchAgent calls the installed Noetica CLI in foreground mode:

```bash
node cli/noetica.mjs start
```

The CLI manages the service through `launchctl`:

- `launchctl bootstrap`
- `launchctl kickstart`
- `launchctl print`
- `launchctl bootout`

Logs are written to:

```text
~/Library/Logs/noetica.out.log
~/Library/Logs/noetica.err.log
```

## Linux / SourceOS

On Linux, Noetica writes a systemd user unit at:

```text
~/.config/systemd/user/noetica.service
```

The user unit calls the installed Noetica CLI in foreground mode:

```bash
node cli/noetica.mjs start
```

The CLI manages the service through:

```bash
systemctl --user daemon-reload
systemctl --user start noetica.service
systemctl --user status noetica.service --no-pager
systemctl --user stop noetica.service
systemctl --user disable noetica.service
```

SourceOS-specific service control or Quadlet integration may extend this path later without changing the Noetica CLI command contract.

## Secret posture

Generated service definitions do not inline provider secrets.

Provider credentials remain referenced through environment variables or later secret-provider integrations such as macOS Keychain, Linux Secret Service, SourceOS vault, or managed identity.

## Foreground target

Both macOS LaunchAgent and Linux systemd user units call the same foreground target used by operators:

```bash
noetica start
```

This keeps service behavior aligned with the debuggable foreground runtime path.
