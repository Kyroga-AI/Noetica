#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { createConnection } from 'node:net'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CONFIG_PATH,
  defaultConfig,
  localUrl,
  providerStatuses,
  readConfig,
  writeDefaultConfig,
} from './noetica-config.mjs'
import { service as serviceCommand } from './noetica-service.mjs'

const __filename = fileURLToPath(import.meta.url)
const repoRoot = resolve(dirname(__filename), '..')
const packagePath = join(repoRoot, 'package.json')
const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'))

const command = process.argv[2] ?? 'help'
const args = process.argv.slice(3)

const commands = new Map([
  ['help', help],
  ['version', version],
  ['doctor', doctor],
  ['configure', configure],
  ['start', start],
  ['open', openNoetica],
  ['smoke', smoke],
  ['service', service],
])

const handler = commands.get(command)

if (!handler) {
  console.error(`Unknown command: ${command}`)
  help()
  process.exit(2)
}

await handler(args)

function help() {
  console.log(`Noetica workstation CLI

Usage:
  noetica <command> [options]

Commands:
  version                              Print version and installation metadata
  doctor [--json]                      Report local readiness
  configure [--force]                  Create SourceOS-aligned user configuration
  start [-- ...]                       Start Noetica in foreground mode
  open                                 Open the configured local Noetica URL
  smoke [--dry-run|--provider <id>]    Run dry-run or provider smoke checks
  service <action>                     OS-native service lifecycle commands

Service actions:
  install | start | status | stop | uninstall
`)
}

function version() {
  console.log(JSON.stringify({
    name: packageJson.name,
    version: packageJson.version,
    private: packageJson.private === true,
    installRoot: repoRoot,
    configPath: CONFIG_PATH,
    phase: 'phase-1-service-adapters',
  }, null, 2))
}

async function doctor(args = []) {
  const json = args.includes('--json')
  const configState = readConfig()
  const config = configState.config
  const effectiveConfig = config ?? defaultConfig()
  const providers = providerStatuses(config)
  const configOk = configState.exists && configState.errors.length === 0
  const configuredProviders = providers.filter((provider) => provider.status === 'configured').length
  const portProbe = await probePort(effectiveConfig.server.host, effectiveConfig.server.port)
  const checks = [
    check('package_json', existsSync(packagePath), packagePath, true),
    check('app_directory', existsSync(join(repoRoot, 'app')), join(repoRoot, 'app'), true),
    check('config_file', configState.exists, configState.path),
    check('config_valid', configOk, configState.errors.length ? configState.errors.join(',') : 'ok'),
    check('local_port_available', portProbe.available, `${effectiveConfig.server.host}:${effectiveConfig.server.port}`),
    check('provider_routes', providers.length > 0, `${providers.length} route(s)`),
    check('provider_configured', configuredProviders > 0, `${configuredProviders} configured provider(s)`),
    check('agent_machine', commandExists('agent-machine'), 'optional in Phase 1'),
    check('prophet_mesh', providerStatus(providers, 'prophet-mesh') === 'deferred', 'deferred in Phase 1'),
  ]

  const result = {
    kind: 'NoeticaDoctor',
    status: checks.every((candidate) => candidate.required !== true || candidate.ok) ? 'ok' : 'degraded',
    phase: 'phase-1-service-adapters',
    config: {
      path: configState.path,
      exists: configState.exists,
      errors: configState.errors,
      warnings: configState.warnings,
      localUrl: localUrl(effectiveConfig),
    },
    runtime: {
      host: effectiveConfig.server.host,
      port: effectiveConfig.server.port,
      portAvailable: portProbe.available,
      portState: portProbe.state,
    },
    providers,
    checks,
  }

  if (json) {
    console.log(JSON.stringify(result, null, 2))
    return
  }

  console.log('Noetica doctor')
  console.log(`status: ${result.status}`)
  console.log(`config: ${configState.path}`)
  console.log(`local_url: ${localUrl(effectiveConfig)}`)
  for (const item of checks) {
    const marker = item.ok ? 'ok' : item.required ? 'missing' : 'not_configured'
    console.log(`- ${item.name}: ${marker} (${item.detail})`)
  }
  if (providers.length > 0) {
    console.log('providers:')
    for (const provider of providers) {
      const key = provider.apiKeyEnv ? ` key=${provider.keyPresent ? 'present' : 'missing'} env=${provider.apiKeyEnv}` : ''
      console.log(`- ${provider.id}: ${provider.status} kind=${provider.kind}${key}`)
    }
  }
}

function configure(args = []) {
  const force = args.includes('--force')
  const result = writeDefaultConfig({ force })

  console.log(JSON.stringify({
    kind: 'NoeticaConfigure',
    path: result.path,
    status: result.status,
    wrote: result.wrote,
    secretPolicy: 'raw provider secrets are not written; env var references only',
  }, null, 2))
}

async function start(args = []) {
  const configState = readConfig()
  const config = configState.config ?? defaultConfig()
  const passThrough = args[0] === '--' ? args.slice(1) : args
  const hasExplicitPort = passThrough.includes('--port') || passThrough.includes('-p')
  const hasExplicitHostname = passThrough.includes('--hostname') || passThrough.includes('-H')
  const nextArgs = [
    ...(hasExplicitHostname ? [] : ['--hostname', config.server.host]),
    ...(hasExplicitPort ? [] : ['--port', String(config.server.port)]),
    ...passThrough,
  ]

  const portProbe = await probePort(config.server.host, config.server.port)
  if (!hasExplicitPort && !portProbe.available) {
    console.error(JSON.stringify({
      kind: 'NoeticaStartRefused',
      status: 'port_unavailable',
      host: config.server.host,
      port: config.server.port,
      detail: portProbe.state,
      hint: 'Use noetica doctor --json for diagnostics, free the port, update config, or pass -- --port <port>.',
    }, null, 2))
    process.exit(1)
  }

  console.log(JSON.stringify({
    kind: 'NoeticaStart',
    mode: 'foreground',
    url: localUrl(config),
    configPath: configState.path,
    nextArgs,
  }, null, 2))

  await run('npm', ['run', 'dev', '--', ...nextArgs], { cwd: repoRoot })
}

async function openNoetica() {
  const config = readConfig().config ?? defaultConfig()
  const url = process.env.NOETICA_URL ?? localUrl(config)
  const platform = process.platform

  if (platform === 'darwin') {
    await run('open', [url])
    return
  }

  if (platform === 'linux') {
    await run('xdg-open', [url])
    return
  }

  console.log(url)
}

async function smoke(args = []) {
  const providerId = valueAfter(args, '--provider')
  const dryRun = !providerId && (args.length === 0 || args.includes('--dry-run'))

  if (dryRun) {
    await smokeDryRun()
    return
  }

  if (!providerId) {
    console.error('Usage: noetica smoke --dry-run | --provider <provider-id>')
    process.exit(2)
  }

  const result = await smokeProvider(providerId)
  console.log(JSON.stringify(result, null, 2))

  if (result.status !== 'ok') {
    process.exit(1)
  }
}

async function smokeDryRun() {
  const configState = readConfig()
  const config = configState.config ?? defaultConfig()
  const providers = providerStatuses(configState.config)
  const portProbe = await probePort(config.server.host, config.server.port)

  console.log(JSON.stringify({
    kind: 'NoeticaSmoke',
    mode: 'dry_run',
    status: 'ok',
    config: {
      path: configState.path,
      exists: configState.exists,
      valid: configState.errors.length === 0,
      localUrl: localUrl(config),
    },
    runtime: {
      host: config.server.host,
      port: config.server.port,
      portAvailable: portProbe.available,
      portState: portProbe.state,
    },
    providers,
    checks: [
      { name: 'cli_loaded', ok: true },
      { name: 'package_json', ok: existsSync(packagePath) },
      { name: 'config_readable_or_absent', ok: configState.errors.length === 0 },
      { name: 'local_port_available', ok: portProbe.available },
    ],
  }, null, 2))
}

async function smokeProvider(providerId) {
  const configState = readConfig()
  const config = configState.config
  const route = config?.providers?.routes?.find((candidate) => candidate.id === providerId)

  if (configState.errors.length > 0) {
    return providerSmokeResult(providerId, 'config_invalid', { errors: configState.errors })
  }

  if (!route) {
    return providerSmokeResult(providerId, 'provider_not_found')
  }

  if (route.phase === 'deferred') {
    return providerSmokeResult(providerId, 'provider_deferred', { phase: route.phase })
  }

  if (route.enabled !== true) {
    return providerSmokeResult(providerId, 'provider_disabled')
  }

  if (route.apiKeyEnv && !process.env[route.apiKeyEnv]) {
    return providerSmokeResult(providerId, 'missing_key', { apiKeyEnv: route.apiKeyEnv })
  }

  if (route.kind === 'openai-compatible') {
    return smokeOpenAICompatible(route)
  }

  if (route.kind === 'anthropic') {
    return smokeAnthropic(route)
  }

  return providerSmokeResult(providerId, 'provider_kind_not_supported', { kind: route.kind })
}

async function smokeOpenAICompatible(route) {
  const startedAt = Date.now()
  const url = joinUrl(route.baseUrl, '/models')
  const response = await fetchWithTimeout(url, {
    headers: route.apiKeyEnv ? { Authorization: `Bearer ${process.env[route.apiKeyEnv]}` } : {},
  })

  const body = await safeBody(response)
  return {
    kind: 'NoeticaProviderSmoke',
    providerId: route.id,
    providerKind: route.kind,
    status: response.ok ? 'ok' : 'provider_error',
    endpoint: redactUrl(url),
    httpStatus: response.status,
    latencyMs: Date.now() - startedAt,
    evidence: summarizeBody(body),
  }
}

async function smokeAnthropic(route) {
  const startedAt = Date.now()
  const url = joinUrl(route.baseUrl, '/v1/models')
  const response = await fetchWithTimeout(url, {
    headers: {
      'anthropic-version': '2023-06-01',
      'x-api-key': process.env[route.apiKeyEnv],
    },
  })

  const body = await safeBody(response)
  return {
    kind: 'NoeticaProviderSmoke',
    providerId: route.id,
    providerKind: route.kind,
    status: response.ok ? 'ok' : 'provider_error',
    endpoint: redactUrl(url),
    httpStatus: response.status,
    latencyMs: Date.now() - startedAt,
    evidence: summarizeBody(body),
  }
}

function service(args = []) {
  const action = args[0]
  const valid = new Set(['install', 'start', 'status', 'stop', 'uninstall'])

  if (!valid.has(action)) {
    console.error('Usage: noetica service <install|start|status|stop|uninstall>')
    process.exit(2)
  }

  console.log(JSON.stringify(serviceCommand(action), null, 2))
}

function check(name, ok, detail, required = false) {
  return { name, ok, detail, required }
}

function providerStatus(providers, id) {
  return providers.find((provider) => provider.id === id)?.status ?? 'not_configured'
}

function providerSmokeResult(providerId, status, extra = {}) {
  return {
    kind: 'NoeticaProviderSmoke',
    providerId,
    status,
    ...extra,
  }
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10000)
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } catch (error) {
    return {
      ok: false,
      status: 0,
      text: async () => JSON.stringify({ error: error.message }),
    }
  } finally {
    clearTimeout(timeout)
  }
}

async function safeBody(response) {
  try {
    const text = await response.text()
    if (!text) return null
    return JSON.parse(text)
  } catch {
    return null
  }
}

function summarizeBody(body) {
  if (!body || typeof body !== 'object') return null
  if (Array.isArray(body.data)) {
    return {
      object: body.object ?? null,
      count: body.data.length,
      firstIds: body.data.slice(0, 5).map((item) => item.id).filter(Boolean),
    }
  }
  if (body.error) {
    return {
      error: typeof body.error === 'string' ? body.error : body.error.message ?? body.error.type ?? 'provider_error',
    }
  }
  return {
    keys: Object.keys(body).slice(0, 10),
  }
}

function valueAfter(args, name) {
  const index = args.indexOf(name)
  if (index < 0) return null
  return args[index + 1] ?? null
}

function joinUrl(baseUrl, path) {
  return `${baseUrl.replace(/\/$/, '')}/${path.replace(/^\//, '')}`
}

function redactUrl(url) {
  return url.replace(/([?&](?:key|token|api_key)=)[^&]+/gi, '$1<redacted>')
}

async function probePort(host, port) {
  return new Promise((resolvePromise) => {
    const socket = createConnection({ host, port, timeout: 1000 })
    socket.on('connect', () => {
      socket.destroy()
      resolvePromise({ available: false, state: 'in_use' })
    })
    socket.on('timeout', () => {
      socket.destroy()
      resolvePromise({ available: true, state: 'no_listener_timeout' })
    })
    socket.on('error', (error) => {
      if (error.code === 'ECONNREFUSED') {
        resolvePromise({ available: true, state: 'available' })
        return
      }
      resolvePromise({ available: false, state: error.code ?? 'probe_error' })
    })
  })
}

function commandExists(name) {
  const pathVar = process.env.PATH ?? ''
  const segments = pathVar.split(process.platform === 'win32' ? ';' : ':')
  return segments.some((segment) => existsSync(join(segment, name)))
}

function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', ...options })
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) {
        resolvePromise()
        return
      }
      reject(new Error(`${command} exited with code ${code}`))
    })
  })
}
