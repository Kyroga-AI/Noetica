#!/usr/bin/env node
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const DEVELOPMENT_RISK_AVERSION_EXPORT_DIR = '.noetica/risk-aversion/traces'

export function resolveRiskAversionExportDir({
  mode = process.env.NOETICA_RISK_AVERSION_EXPORT_MODE ?? 'development',
  env = process.env,
  platform = process.platform,
  homeDir = homedir()
} = {}) {
  if (env.NOETICA_RISK_AVERSION_DIR) {
    return normalizeExportPath(env.NOETICA_RISK_AVERSION_DIR)
  }

  if (mode === 'development') {
    return DEVELOPMENT_RISK_AVERSION_EXPORT_DIR
  }

  if (mode !== 'production') {
    throw new Error(`unsupported risk-aversion export mode: ${mode}`)
  }

  if (platform === 'darwin') {
    return join(homeDir, 'Library', 'Application Support', 'Noetica', 'risk-aversion', 'traces')
  }

  if (platform === 'linux') {
    const stateHome = env.XDG_STATE_HOME || join(homeDir, '.local', 'state')
    return join(stateHome, 'noetica', 'risk-aversion', 'traces')
  }

  throw new Error(
    `unsupported production risk-aversion export platform: ${platform}; set NOETICA_RISK_AVERSION_DIR explicitly`
  )
}

export function normalizeExportPath(value) {
  return isAbsolute(value) ? value : resolve(value)
}

function parseCliArgs(argv) {
  const args = { mode: undefined, json: false }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--json') {
      args.json = true
    } else if (arg === '--mode') {
      args.mode = argv[++i]
      if (!args.mode) throw new Error('--mode requires a value')
    } else {
      throw new Error(`unknown argument: ${arg}`)
    }
  }
  return args
}

function main(argv) {
  const args = parseCliArgs(argv)
  const mode = args.mode ?? process.env.NOETICA_RISK_AVERSION_EXPORT_MODE ?? 'development'
  const outputDir = resolveRiskAversionExportDir({ mode })
  if (args.json) {
    console.log(JSON.stringify({
      kind: 'NoeticaRiskAversionExportPath',
      mode,
      outputDir
    }, null, 2))
  } else {
    console.log(outputDir)
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2))
}
