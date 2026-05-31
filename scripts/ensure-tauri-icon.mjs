#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const iconPath = resolve('src-tauri/icons/icon.png');

// 1x1 transparent 8-bit RGBA PNG. This is a feasibility placeholder only.
// The production packaging tranche must replace this with the real icon set.
const transparentRgbaPngBase64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=';

await mkdir(dirname(iconPath), { recursive: true });
await writeFile(iconPath, Buffer.from(transparentRgbaPngBase64, 'base64'));
console.log(`Ensured Tauri feasibility RGBA icon at ${iconPath}`);
