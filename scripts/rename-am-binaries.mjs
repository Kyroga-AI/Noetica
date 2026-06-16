/**
 * Renames agent-machine binaries from @yao-pkg/pkg output format to
 * Tauri's expected sidecar naming: binaries/agent-machine-{target_triple}
 *
 * @yao-pkg/pkg outputs:  server-macos-arm64, server-macos, server-win.exe, server-linux
 * Tauri expects:         agent-machine-aarch64-apple-darwin
 *                        agent-machine-x86_64-apple-darwin
 *                        agent-machine-x86_64-pc-windows-msvc.exe
 *                        agent-machine-x86_64-unknown-linux-gnu
 */

import { renameSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dir = dirname(fileURLToPath(import.meta.url))
const binDir = join(__dir, '../src-tauri/binaries')

if (!existsSync(binDir)) {
  mkdirSync(binDir, { recursive: true })
}

const renames = [
  // @yao-pkg/pkg name             → Tauri sidecar name
  ['server-macos-arm64',           'agent-machine-aarch64-apple-darwin'],
  ['server-macos',                 'agent-machine-x86_64-apple-darwin'],
  ['server-win.exe',               'agent-machine-x86_64-pc-windows-msvc.exe'],
  ['server-linux',                 'agent-machine-x86_64-unknown-linux-gnu'],
]

let renamed = 0
for (const [from, to] of renames) {
  const src = join(binDir, from)
  const dst = join(binDir, to)
  if (existsSync(src)) {
    renameSync(src, dst)
    console.log(`  renamed: ${from} → ${to}`)
    renamed++
  }
}

if (renamed === 0) {
  console.warn('No binaries found to rename. Did @yao-pkg/pkg run successfully?')
} else {
  console.log(`\nDone. ${renamed} binaries placed in src-tauri/binaries/`)
}
