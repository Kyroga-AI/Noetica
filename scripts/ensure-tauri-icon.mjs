#!/usr/bin/env node
/**
 * Ensures the minimum set of Tauri icons exist for a build.
 *
 * If the real generated icons are already present (committed to the repo or
 * produced by a prior `npx tauri icon` run) this script exits immediately.
 *
 * If they are missing it writes a 1×1 placeholder so that `cargo check` and
 * other non-bundling steps can still run. A real `tauri build` (bundling)
 * will fail without properly sized icons — regenerate them with:
 *   npx @tauri-apps/cli icon <source-1024x1024.png>
 */
import { access, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const REQUIRED = [
  'src-tauri/icons/32x32.png',
  'src-tauri/icons/128x128.png',
  'src-tauri/icons/128x128@2x.png',
  'src-tauri/icons/icon.icns',
  'src-tauri/icons/icon.ico',
];

async function exists(p) {
  try { await access(resolve(p)); return true } catch { return false }
}

const allPresent = (await Promise.all(REQUIRED.map(exists))).every(Boolean);
if (allPresent) {
  console.log('Tauri icons already present — skipping placeholder generation.');
  process.exit(0);
}

// Fallback: write a 1×1 transparent placeholder so cargo check can proceed.
// This is NOT sufficient for a real bundle — see script header.
const iconPath = resolve('src-tauri/icons/icon.png');
const transparentRgbaPngBase64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=';

await mkdir(dirname(iconPath), { recursive: true });
await writeFile(iconPath, Buffer.from(transparentRgbaPngBase64, 'base64'));
console.log(`Tauri icons missing — wrote placeholder at ${iconPath} (cargo-check only)`);
