import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

const SERVICE_LABEL = 'ai.noetica.app'
const SERVICE_NAME = 'noetica.service'
const __filename = fileURLToPath(import.meta.url)
const CLI_PATH = __filename.replace(/noetica-service\.mjs$/, 'noetica.mjs')

export function service(action) {
  if (process.platform === 'darwin') return macosService(action)
  if (process.platform === 'linux') return linuxService(action)
  return {
    kind: 'NoeticaServiceCommand',
    action,
    status: 'unsupported_platform',
    platform: process.platform,
  }
}

function macosService(action) {
  const plistPath = join(homedir(), 'Library', 'LaunchAgents', `${SERVICE_LABEL}.plist`)
  const uid = process.getuid?.() ?? null
  const guiTarget = uid === null ? null : `gui/${uid}`

  if (action === 'install') {
    mkdirSync(dirname(plistPath), { recursive: true })
    writeFileSync(plistPath, macosPlist(), { mode: 0o644 })
    return {
      kind: 'NoeticaServiceCommand',
      backend: 'launchctl',
      action,
      status: 'installed',
      path: plistPath,
      next: 'noetica service start',
    }
  }

  if (action === 'start') {
    if (!existsSync(plistPath)) return missingService(action, 'launchctl', plistPath)
    const bootstrap = runCapture('launchctl', ['bootstrap', guiTarget, plistPath])
    if (bootstrap.status !== 0 && !String(bootstrap.stderr).includes('already bootstrapped')) {
      return commandResult(action, 'launchctl', bootstrap, { path: plistPath })
    }
    const kickstart = runCapture('launchctl', ['kickstart', '-k', `${guiTarget}/${SERVICE_LABEL}`])
    return commandResult(action, 'launchctl', kickstart, { path: plistPath })
  }

  if (action === 'status') {
    const result = guiTarget
      ? runCapture('launchctl', ['print', `${guiTarget}/${SERVICE_LABEL}`])
      : { status: 1, stdout: '', stderr: 'no uid available' }
    return commandResult(action, 'launchctl', result, { path: plistPath })
  }

  if (action === 'stop') {
    const result = guiTarget
      ? runCapture('launchctl', ['bootout', guiTarget, plistPath])
      : { status: 1, stdout: '', stderr: 'no uid available' }
    return commandResult(action, 'launchctl', result, { path: plistPath })
  }

  if (action === 'uninstall') {
    if (guiTarget && existsSync(plistPath)) runCapture('launchctl', ['bootout', guiTarget, plistPath])
    if (existsSync(plistPath)) unlinkSync(plistPath)
    return {
      kind: 'NoeticaServiceCommand',
      backend: 'launchctl',
      action,
      status: 'uninstalled',
      path: plistPath,
    }
  }

  return invalidAction(action)
}

function linuxService(action) {
  const unitDir = join(homedir(), '.config', 'systemd', 'user')
  const unitPath = join(unitDir, SERVICE_NAME)

  if (action === 'install') {
    mkdirSync(unitDir, { recursive: true })
    writeFileSync(unitPath, systemdUnit(), { mode: 0o644 })
    const reload = runCapture('systemctl', ['--user', 'daemon-reload'])
    return commandResult(action, 'systemd --user', reload, {
      path: unitPath,
      next: 'noetica service start',
    })
  }

  if (action === 'start') {
    if (!existsSync(unitPath)) return missingService(action, 'systemd --user', unitPath)
    const result = runCapture('systemctl', ['--user', 'start', SERVICE_NAME])
    return commandResult(action, 'systemd --user', result, { path: unitPath })
  }

  if (action === 'status') {
    const result = runCapture('systemctl', ['--user', 'status', SERVICE_NAME, '--no-pager'])
    return commandResult(action, 'systemd --user', result, { path: unitPath })
  }

  if (action === 'stop') {
    const result = runCapture('systemctl', ['--user', 'stop', SERVICE_NAME])
    return commandResult(action, 'systemd --user', result, { path: unitPath })
  }

  if (action === 'uninstall') {
    runCapture('systemctl', ['--user', 'stop', SERVICE_NAME])
    runCapture('systemctl', ['--user', 'disable', SERVICE_NAME])
    if (existsSync(unitPath)) unlinkSync(unitPath)
    const reload = runCapture('systemctl', ['--user', 'daemon-reload'])
    return commandResult(action, 'systemd --user', reload, { path: unitPath, removed: true })
  }

  return invalidAction(action)
}

function macosPlist() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${SERVICE_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${process.execPath}</string>
    <string>${CLI_PATH}</string>
    <string>start</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <false/>
  <key>StandardOutPath</key>
  <string>${join(homedir(), 'Library', 'Logs', 'noetica.out.log')}</string>
  <key>StandardErrorPath</key>
  <string>${join(homedir(), 'Library', 'Logs', 'noetica.err.log')}</string>
  <key>WorkingDirectory</key>
  <string>${dirname(dirname(CLI_PATH))}</string>
</dict>
</plist>
`
}

function systemdUnit() {
  return `[Unit]
Description=Noetica governed workstation UI
After=network-online.target

[Service]
Type=simple
ExecStart=${process.execPath} ${CLI_PATH} start
Restart=on-failure
RestartSec=5
WorkingDirectory=${dirname(dirname(CLI_PATH))}

[Install]
WantedBy=default.target
`
}

function runCapture(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' })
  return {
    status: result.status ?? 1,
    stdout: trimOutput(result.stdout),
    stderr: trimOutput(result.stderr || result.error?.message || ''),
  }
}

function commandResult(action, backend, result, extra = {}) {
  return {
    kind: 'NoeticaServiceCommand',
    backend,
    action,
    status: result.status === 0 ? 'ok' : 'error',
    exitCode: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    ...extra,
  }
}

function missingService(action, backend, path) {
  return {
    kind: 'NoeticaServiceCommand',
    backend,
    action,
    status: 'not_installed',
    path,
    hint: 'Run noetica service install first.',
  }
}

function invalidAction(action) {
  return {
    kind: 'NoeticaServiceCommand',
    action,
    status: 'invalid_action',
  }
}

function trimOutput(value) {
  if (!value) return ''
  const text = String(value).trim()
  if (text.length <= 4000) return text
  return `${text.slice(0, 4000)}...<truncated>`
}
