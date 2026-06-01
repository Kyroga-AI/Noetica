#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'

const checks = []

await checkFile('packaging/linux/ai.noetica.app.desktop', validateDesktopFile)
await checkFile('packaging/linux/ai.noetica.app.metainfo.xml', validateMetainfo)
await checkFile('packaging/macos/release-metadata.json', validateMacosMetadata)
await checkFile('packaging/macos/noetica.entitlements.plist', validateEntitlements)
await checkFile('packaging/provenance/release-evidence.template.json', validateReleaseEvidenceTemplate)

const failed = checks.filter((check) => !check.ok)
for (const check of checks) {
  console.log(`${check.ok ? 'ok' : 'fail'} ${check.path}${check.detail ? ` ${check.detail}` : ''}`)
}

if (failed.length > 0) {
  process.exit(1)
}

async function checkFile(path, validator) {
  if (!existsSync(path)) {
    checks.push({ path, ok: false, detail: 'missing' })
    return
  }

  const content = await readFile(path, 'utf8')
  const result = validator(content)
  checks.push({ path, ...result })
}

function validateDesktopFile(content) {
  const required = [
    '[Desktop Entry]',
    'Name=Noetica',
    'Exec=noetica-app',
    'Icon=ai.noetica.app',
    'Terminal=false',
    'Type=Application',
    'Categories=Development;Utility;',
    'StartupWMClass=Noetica'
  ]
  return requireContains(content, required)
}

function validateMetainfo(content) {
  const required = [
    '<component type="desktop-application">',
    '<id>ai.noetica.app</id>',
    '<name>Noetica</name>',
    '<launchable type="desktop-id">ai.noetica.app.desktop</launchable>'
  ]
  return requireContains(content, required)
}

function validateMacosMetadata(content) {
  const metadata = parseJson(content)
  if (!metadata.ok) return metadata
  const value = metadata.value
  const requiredMatches = [
    ['schema_version', 'noetica.macos.release-metadata.v0.1'],
    ['product_name', 'Noetica'],
    ['bundle_identifier', 'ai.noetica.app'],
    ['bundle_type', 'tauri-app']
  ]

  for (const [key, expected] of requiredMatches) {
    if (value[key] !== expected) return { ok: false, detail: `${key}_mismatch` }
  }

  if (value.signing?.implemented !== false) return { ok: false, detail: 'signing_must_remain_unimplemented_placeholder' }
  if (value.notarization?.implemented !== false) return { ok: false, detail: 'notarization_must_remain_unimplemented_placeholder' }
  if (value.signing?.entitlements_path !== 'packaging/macos/noetica.entitlements.plist') {
    return { ok: false, detail: 'entitlements_path_mismatch' }
  }

  return { ok: true }
}

function validateEntitlements(content) {
  const required = [
    '<plist version="1.0">',
    '<key>com.apple.security.cs.allow-jit</key>',
    '<false/>',
    '<key>com.apple.security.network.client</key>',
    '<true/>'
  ]
  return requireContains(content, required)
}

function validateReleaseEvidenceTemplate(content) {
  const metadata = parseJson(content)
  if (!metadata.ok) return metadata
  const value = metadata.value
  const requiredKeys = [
    'schema_version',
    'source_commit',
    'workflow_run',
    'node_lockfile_hash',
    'cargo_lockfile_hash',
    'static_ui_artifact_hash',
    'tauri_bundle_artifact_hash',
    'sbom_path',
    'provenance_attestation_path'
  ]

  for (const key of requiredKeys) {
    if (!(key in value)) return { ok: false, detail: `missing_${key}` }
  }

  if (value.schema_version !== 'noetica.release-evidence.v0.1') return { ok: false, detail: 'schema_version_mismatch' }
  return { ok: true }
}

function requireContains(content, required) {
  const missing = required.filter((needle) => !content.includes(needle))
  if (missing.length > 0) return { ok: false, detail: `missing:${missing.join(',')}` }
  return { ok: true }
}

function parseJson(content) {
  try {
    return { ok: true, value: JSON.parse(content) }
  } catch (error) {
    return { ok: false, detail: `invalid_json:${error instanceof Error ? error.message : 'unknown'}` }
  }
}
