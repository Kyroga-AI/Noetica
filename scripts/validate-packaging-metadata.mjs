#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'

const checks = []

await checkFile('packaging/linux/ai.noetica.app.desktop', validateDesktopFile)
await checkFile('packaging/linux/ai.noetica.app.metainfo.xml', validateMetainfo)
await checkFile('packaging/macos/release-metadata.json', validateMacosMetadata)
await checkFile('packaging/macos/noetica.entitlements.plist', validateEntitlements)
await checkFile('packaging/provenance/release-evidence.template.json', validateReleaseEvidenceTemplate)
await checkFile('packaging/icons/icon-manifest.json', validateIconManifest)
await checkFile('packaging/icons/source/noetica-icon.source.svg', validateSourceIcon)

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

function validateIconManifest(content) {
  const metadata = parseJson(content)
  if (!metadata.ok) return metadata
  const value = metadata.value

  if (value.schema_version !== 'noetica.icon-manifest.v0.1') return { ok: false, detail: 'schema_version_mismatch' }
  if (value.app_id !== 'ai.noetica.app') return { ok: false, detail: 'app_id_mismatch' }
  if (value.product_name !== 'Noetica') return { ok: false, detail: 'product_name_mismatch' }
  if (value.source_asset?.path !== 'packaging/icons/source/noetica-icon.source.svg') return { ok: false, detail: 'source_asset_path_mismatch' }
  if (value.source_asset?.status !== 'placeholder') return { ok: false, detail: 'source_asset_status_must_be_placeholder_in_phase_1h' }
  if (value.release_policy?.placeholder_allowed_in_phase_1h !== true) return { ok: false, detail: 'phase_1h_placeholder_policy_missing' }
  if (value.release_policy?.placeholder_allowed_for_production_release !== false) return { ok: false, detail: 'production_placeholder_policy_invalid' }

  const linuxPng = value.outputs?.linux_png
  if (!Array.isArray(linuxPng)) return { ok: false, detail: 'linux_png_outputs_missing' }
  const requiredSizes = [16, 32, 48, 64, 128, 256, 512]
  const foundSizes = linuxPng.map((item) => item.size).sort((a, b) => a - b)
  if (JSON.stringify(foundSizes) !== JSON.stringify(requiredSizes)) return { ok: false, detail: 'linux_png_sizes_mismatch' }

  for (const item of linuxPng) {
    if (!item.path?.includes(`${item.size}x${item.size}/apps/ai.noetica.app.png`)) {
      return { ok: false, detail: `linux_png_path_mismatch_${item.size}` }
    }
    if (item.status !== 'pending_generation') return { ok: false, detail: `linux_png_status_mismatch_${item.size}` }
  }

  if (value.outputs?.macos_icns?.path !== 'packaging/icons/macos/noetica.icns') return { ok: false, detail: 'macos_icns_path_mismatch' }
  if (value.outputs?.macos_icns?.status !== 'pending_generation') return { ok: false, detail: 'macos_icns_status_mismatch' }

  const marketing = value.outputs?.marketing
  if (!Array.isArray(marketing) || marketing.length !== 2) return { ok: false, detail: 'marketing_outputs_missing' }
  if (!marketing.some((item) => item.size === 512) || !marketing.some((item) => item.size === 1024)) {
    return { ok: false, detail: 'marketing_sizes_mismatch' }
  }

  return { ok: true }
}

function validateSourceIcon(content) {
  const required = [
    '<svg',
    'viewBox="0 0 1024 1024"',
    'Noetica placeholder icon',
    'Replace before production release.'
  ]
  return requireContains(content, required)
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
