#!/usr/bin/env node
import { join, resolve } from 'node:path'

import { resolveSourceOSEventExportDir } from './sourceos-event-export-path.mjs'

const linuxHome = '/home/noetica'
const macHome = '/Users/noetica'

const checks = [
  {
    name: 'development-default',
    actual: resolveSourceOSEventExportDir({ mode: 'development', env: {}, platform: 'linux', homeDir: linuxHome }),
    expected: '.noetica/events'
  },
  {
    name: 'override-relative',
    actual: resolveSourceOSEventExportDir({
      mode: 'production',
      env: { NOETICA_SOURCEOS_EVENT_DIR: 'tmp/sourceos-events' },
      platform: 'linux',
      homeDir: linuxHome
    }),
    expected: resolve('tmp/sourceos-events')
  },
  {
    name: 'override-absolute',
    actual: resolveSourceOSEventExportDir({
      mode: 'production',
      env: { NOETICA_SOURCEOS_EVENT_DIR: '/var/tmp/noetica-sourceos-events' },
      platform: 'linux',
      homeDir: linuxHome
    }),
    expected: '/var/tmp/noetica-sourceos-events'
  },
  {
    name: 'linux-production-xdg-state-home',
    actual: resolveSourceOSEventExportDir({
      mode: 'production',
      env: { XDG_STATE_HOME: '/state' },
      platform: 'linux',
      homeDir: linuxHome
    }),
    expected: '/state/noetica/sourceos/events'
  },
  {
    name: 'linux-production-fallback',
    actual: resolveSourceOSEventExportDir({ mode: 'production', env: {}, platform: 'linux', homeDir: linuxHome }),
    expected: join(linuxHome, '.local', 'state', 'noetica', 'sourceos', 'events')
  },
  {
    name: 'macos-production',
    actual: resolveSourceOSEventExportDir({ mode: 'production', env: {}, platform: 'darwin', homeDir: macHome }),
    expected: join(macHome, 'Library', 'Application Support', 'Noetica', 'sourceos', 'events')
  }
]

for (const check of checks) {
  if (check.actual !== check.expected) {
    throw new Error(`${check.name}: expected ${check.expected}, got ${check.actual}`)
  }
}

console.log(JSON.stringify({
  kind: 'NoeticaSourceOSEventExportPathCheck',
  status: 'ok',
  checks: checks.map(({ name, actual }) => ({ name, actual }))
}, null, 2))
