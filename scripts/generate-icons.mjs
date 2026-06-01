#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname } from 'node:path'

const manifestPath = 'packaging/icons/icon-manifest.json'
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
const sourcePath = manifest.source_asset?.path

if (!sourcePath || !existsSync(sourcePath)) {
  throw new Error(`missing icon source asset: ${sourcePath ?? '<unset>'}`)
}

const source = await readFile(sourcePath, 'utf8')
const generatedAt = new Date().toISOString()
const generated = []

for (const output of manifest.outputs?.linux_svg ?? []) {
  const svg = resizeSvg(source, output.size, generatedAt)
  await mkdir(dirname(output.path), { recursive: true })
  await writeFile(output.path, svg)
  generated.push(output.path)
}

for (const output of manifest.outputs?.marketing_svg ?? []) {
  const svg = resizeSvg(source, output.size, generatedAt)
  await mkdir(dirname(output.path), { recursive: true })
  await writeFile(output.path, svg)
  generated.push(output.path)
}

console.log(JSON.stringify({
  kind: 'NoeticaIconGeneration',
  manifest: manifestPath,
  source: sourcePath,
  generated,
  note: 'PNG and ICNS generation require a raster/vector conversion toolchain in a later release workflow tranche.'
}, null, 2))

function resizeSvg(svg, size, generatedAt) {
  if (!Number.isInteger(size) || size <= 0) {
    throw new Error(`invalid icon size: ${size}`)
  }

  const withoutXml = svg.replace(/^<\?xml[^>]*>\s*/u, '')
  const withSize = withoutXml
    .replace(/<svg\b([^>]*)>/u, `<svg$1 width="${size}" height="${size}" data-generated-at="${generatedAt}">`)

  if (!withSize.includes(`width="${size}"`) || !withSize.includes(`height="${size}"`)) {
    throw new Error(`failed to stamp SVG size ${size}`)
  }

  return `${withSize.trim()}\n`
}
