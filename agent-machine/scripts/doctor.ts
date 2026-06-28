#!/usr/bin/env tsx
/**
 * doctor — one command to see WHY things are slow/crashing. The ergonomic answer to this session's repeated
 * "the box fell to CPU and I didn't know." Prints the resolved preset, RAM headroom, ollama health, and —
 * critically — whether the model is actually on Metal/GPU or has fallen to CPU.
 *
 *   npx tsx scripts/doctor.ts
 */
import * as os from 'node:os'
import { resolveConfig, summarize } from '../lib/presets.js'

const BASE = process.env['OLLAMA_HOST'] || 'http://127.0.0.1:11434'
const ramGb = os.totalmem() / 1e9
const freeGb = os.freemem() / 1e9

async function main(): Promise<void> {
  console.log('— Noetica doctor —')
  const cfg = resolveConfig()
  console.log('config:', summarize(cfg, ramGb))
  console.log(`memory: ${freeGb.toFixed(1)}/${ramGb.toFixed(0)} GB free`)

  // ollama health + model placement (the crash-cause this box hit)
  try {
    const tags = await (await fetch(`${BASE}/api/tags`, { signal: AbortSignal.timeout(3000) })).json() as { models?: Array<{ name: string }> }
    const names = (tags.models ?? []).map((m) => m.name)
    console.log(`ollama: UP · ${names.length} models · target=${cfg.model} ${names.includes(cfg.model) ? '✓ present' : '✗ NOT PULLED → ollama pull ' + cfg.model}`)
    const ps = await (await fetch(`${BASE}/api/ps`, { signal: AbortSignal.timeout(3000) })).json() as { models?: Array<{ name: string; size?: number; size_vram?: number }> }
    for (const m of ps.models ?? []) {
      const onMetal = (m.size_vram ?? 0) >= (m.size ?? 1) * 0.95
      console.log(`  loaded: ${m.name} ${onMetal ? 'METAL ✓' : 'CPU/PARTIAL ✗ → restart ollama to recover GPU'} (${((m.size_vram ?? 0) / 1e9).toFixed(1)}/${((m.size ?? 0) / 1e9).toFixed(1)} GB vram)`)
    }
    if (!(ps.models ?? []).length) console.log('  (no model resident — loads on first request)')
  } catch {
    console.log(`ollama: DOWN at ${BASE} → start ollama, or set OLLAMA_HOST`)
  }

  // headroom verdict — the soft-degrade guidance we were missing
  const modelGb = cfg.model.includes('14b') ? 9 : cfg.model.includes('7b') || cfg.model.includes('8b') ? 5 : 2
  if (modelGb + 2 > ramGb) console.log(`verdict: ⚠ ${cfg.model} (~${modelGb}GB) is tight on ${ramGb.toFixed(0)}GB — expect CPU fallback under load; use NOETICA_PRESET=lite or a smaller model`)
  else console.log('verdict: ✓ headroom OK')
}

main().catch((e) => { console.error('doctor error:', e); process.exit(1) })
