import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'

export const CONFIG_PATH = join(homedir(), '.config', 'sourceos', 'noetica', 'config.json')
export const CONFIG_SCHEMA_VERSION = 'noetica.config.v0.1'

export function defaultConfig() {
  return {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    server: {
      host: '127.0.0.1',
      port: 3737,
    },
    providers: {
      default: 'openai-compatible',
      routes: [
        {
          id: 'openai-compatible',
          kind: 'openai-compatible',
          baseUrl: 'https://api.openai.com/v1',
          apiKeyEnv: 'OPENAI_API_KEY',
          enabled: false,
        },
        {
          id: 'anthropic',
          kind: 'anthropic',
          baseUrl: 'https://api.anthropic.com',
          apiKeyEnv: 'ANTHROPIC_API_KEY',
          enabled: false,
        },
        {
          id: 'sourceos',
          kind: 'sourceos',
          baseUrl: 'http://127.0.0.1:3741',
          enabled: false,
        },
        {
          id: 'agent-machine',
          kind: 'agent-machine',
          baseUrl: 'http://127.0.0.1:3751',
          enabled: false,
        },
        {
          id: 'prophet-mesh',
          kind: 'openai-compatible',
          baseUrl: 'https://models.socioprophet.ai/v1',
          apiKeyEnv: 'PROPHET_MESH_API_KEY',
          enabled: false,
          phase: 'deferred',
        },
      ],
    },
  }
}

export function readConfig(path = CONFIG_PATH) {
  if (!existsSync(path)) {
    return {
      exists: false,
      path,
      config: null,
      errors: [],
      warnings: ['config_missing'],
    }
  }

  try {
    const config = JSON.parse(readFileSync(path, 'utf8'))
    const validation = validateConfig(config)
    return {
      exists: true,
      path,
      config,
      ...validation,
    }
  } catch (error) {
    return {
      exists: true,
      path,
      config: null,
      errors: [`config_unreadable: ${error.message}`],
      warnings: [],
    }
  }
}

export function writeDefaultConfig({ path = CONFIG_PATH, force = false } = {}) {
  if (existsSync(path) && !force) {
    return {
      path,
      status: 'exists',
      wrote: false,
      config: readConfig(path).config,
    }
  }

  const config = defaultConfig()
  mkdirSync(dirname(path), { recursive: true })

  let fd = null
  try {
    fd = openSync(path, force ? 'w' : 'wx', 0o600)
    writeFileSync(fd, `${JSON.stringify(config, null, 2)}\n`)
  } catch (error) {
    if (error?.code === 'EEXIST' && !force) {
      return {
        path,
        status: 'exists',
        wrote: false,
        config: readConfig(path).config,
      }
    }
    throw error
  } finally {
    if (fd !== null) closeSync(fd)
  }

  return {
    path,
    status: 'created',
    wrote: true,
    config,
  }
}

export function validateConfig(config) {
  const errors = []
  const warnings = []

  if (!config || typeof config !== 'object') {
    return { errors: ['config_not_object'], warnings }
  }

  if (config.schemaVersion !== CONFIG_SCHEMA_VERSION) {
    warnings.push(`schema_version_unexpected:${config.schemaVersion ?? 'missing'}`)
  }

  if (!config.server || typeof config.server !== 'object') {
    errors.push('server_missing')
  } else {
    if (typeof config.server.host !== 'string' || config.server.host.length === 0) {
      errors.push('server.host_missing')
    }
    if (!Number.isInteger(config.server.port) || config.server.port <= 0) {
      errors.push('server.port_invalid')
    }
  }

  const routes = config.providers?.routes
  if (!Array.isArray(routes)) {
    errors.push('providers.routes_missing')
  } else {
    const ids = new Set()
    for (const route of routes) {
      if (!route || typeof route !== 'object') {
        errors.push('providers.routes.entry_not_object')
        continue
      }
      if (!route.id || typeof route.id !== 'string') {
        errors.push('providers.routes.id_missing')
      } else if (ids.has(route.id)) {
        errors.push(`providers.routes.duplicate_id:${route.id}`)
      } else {
        ids.add(route.id)
      }
      if (!route.kind || typeof route.kind !== 'string') {
        errors.push(`providers.routes.kind_missing:${route.id ?? 'unknown'}`)
      }
      if (!route.baseUrl || typeof route.baseUrl !== 'string') {
        errors.push(`providers.routes.baseUrl_missing:${route.id ?? 'unknown'}`)
      }
      if (route.apiKey && typeof route.apiKey === 'string') {
        errors.push(`providers.routes.raw_secret_forbidden:${route.id ?? 'unknown'}`)
      }
    }

    if (config.providers?.default && !ids.has(config.providers.default)) {
      warnings.push(`providers.default_missing_route:${config.providers.default}`)
    }
  }

  return { errors, warnings }
}

export function providerStatuses(config) {
  const routes = config?.providers?.routes
  if (!Array.isArray(routes)) return []

  return routes.map((route) => {
    const keyRequired = typeof route.apiKeyEnv === 'string' && route.apiKeyEnv.length > 0
    const keyPresent = keyRequired ? Boolean(process.env[route.apiKeyEnv]) : null
    let status = 'not_configured'

    if (route.phase === 'deferred') {
      status = 'deferred'
    } else if (route.enabled === true && keyRequired && !keyPresent) {
      status = 'missing_key'
    } else if (route.enabled === true) {
      status = 'configured'
    } else if (route.enabled === false) {
      status = 'disabled'
    }

    return {
      id: route.id,
      kind: route.kind,
      baseUrl: route.baseUrl,
      enabled: route.enabled === true,
      keyRequired,
      keyPresent,
      phase: route.phase ?? 'phase-1',
      status,
    }
  })
}

export function localUrl(config) {
  const host = config?.server?.host ?? '127.0.0.1'
  const port = config?.server?.port ?? 3737
  return `http://${host}:${port}`
}
