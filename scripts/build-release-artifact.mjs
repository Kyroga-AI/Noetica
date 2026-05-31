#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const repoRoot = resolve(dirname(__filename), '..')
const packageJson = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'))
const outDir = join(repoRoot, 'dist', 'release')
const stageDir = join(outDir, `noetica-${packageJson.version}`)
const archiveName = `noetica-${packageJson.version}-node.tar.gz`
const archivePath = join(outDir, archiveName)

main()

function main() {
  rmSync(outDir, { recursive: true, force: true })
  mkdirSync(stageDir, { recursive: true })

  run('npm', ['run', 'build'])

  copyPath('package.json')
  copyPath('cli')
  copyPath('app')
  copyPath('components')
  copyPath('config')
  copyPath('lib')
  copyPath('docs')
  copyPath('public', { optional: true })
  copyPath('next.config.js', { optional: true })
  copyPath('next.config.mjs', { optional: true })
  copyPath('.next')

  const manifest = releaseManifest()
  writeFileSync(join(stageDir, 'NOETICA_RELEASE.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  writeFileSync(join(stageDir, 'README.install.txt'), installReadme())

  run('tar', ['-czf', archivePath, '-C', outDir, basename(stageDir)])

  const archiveSha256 = sha256File(archivePath)
  const receipt = {
    kind: 'NoeticaReleaseArtifactReceipt',
    artifact: archiveName,
    sha256: archiveSha256,
    version: packageJson.version,
    createdAt: new Date().toISOString(),
    validation: {
      build: 'npm run build',
      packageLayout: 'dist/release/noetica-<version>',
    },
  }
  writeFileSync(join(outDir, `${archiveName}.sha256`), `${archiveSha256}  ${archiveName}\n`)
  writeFileSync(join(outDir, `${archiveName}.receipt.json`), `${JSON.stringify(receipt, null, 2)}\n`)

  console.log(JSON.stringify(receipt, null, 2))
}

function releaseManifest() {
  return {
    kind: 'NoeticaReleaseManifest',
    version: packageJson.version,
    name: packageJson.name,
    artifactProfile: 'node-next-standalone-lite',
    entrypoints: {
      cli: 'cli/noetica.mjs',
      foreground: 'node cli/noetica.mjs start',
      doctor: 'node cli/noetica.mjs doctor --json',
      smoke: 'node cli/noetica.mjs smoke --dry-run',
    },
    config: {
      userConfigPath: '~/.config/sourceos/noetica/config.json',
      rawSecretsInConfig: false,
    },
    service: {
      macos: 'LaunchAgent via noetica service ...',
      linux: 'systemd --user via noetica service ...',
      homebrewServices: false,
    },
    files: listFiles(stageDir),
  }
}

function installReadme() {
  return `Noetica release artifact\n\nCommands:\n  node cli/noetica.mjs version\n  node cli/noetica.mjs configure\n  node cli/noetica.mjs doctor\n  node cli/noetica.mjs smoke --dry-run\n  node cli/noetica.mjs start\n\nHomebrew formula work should install this payload and expose cli/noetica.mjs as noetica.\n` 
}

function copyPath(path, options = {}) {
  const source = join(repoRoot, path)
  const target = join(stageDir, path)
  if (!existsSync(source)) {
    if (options.optional) return
    throw new Error(`Missing required release path: ${path}`)
  }
  copyRecursive(source, target)
}

function copyRecursive(source, target) {
  const stat = statSync(source)
  if (stat.isDirectory()) {
    mkdirSync(target, { recursive: true })
    for (const entry of readdirSync(source)) {
      if (entry === 'node_modules') continue
      copyRecursive(join(source, entry), join(target, entry))
    }
    return
  }
  mkdirSync(dirname(target), { recursive: true })
  copyFileSync(source, target)
}

function listFiles(root) {
  const results = []
  walk(root, results)
  return results.sort()
}

function walk(path, results) {
  for (const entry of readdirSync(path)) {
    const absolute = join(path, entry)
    const stat = statSync(absolute)
    if (stat.isDirectory()) {
      walk(absolute, results)
    } else {
      results.push(relative(stageDir, absolute))
    }
  }
}

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function run(command, args) {
  execFileSync(command, args, { cwd: repoRoot, stdio: 'inherit' })
}
