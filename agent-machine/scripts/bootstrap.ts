/**
 * First-run bootstrap — zero host setup.
 *
 *   npm run bootstrap            # dry-run: print the plan for this box
 *   npm run bootstrap -- --execute   # run the T2 native path (provision + pull)
 *
 * The Tauri shell calls the executor on first launch; here it composes the
 * already-verified pieces (profile → plan → provision-runtime → pull models →
 * launch sandboxed runtime). VM/container provisioning (T1) is PM3d (Rust shell).
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { profileHost } from '../lib/host-profile.js'
import { planBootstrap } from '../lib/runtime-orchestrator.js'
import { listLocalModels, pullModel } from '../lib/ollama.js'
const exec = promisify(execFile)

async function main() {
  const execute = process.argv.includes('--execute')
  const profile = await profileHost()
  const installed = await listLocalModels().catch(() => [])
  const plan = planBootstrap(profile, installed)

  console.log(`\n▸ Host: ${profile.os}/${profile.arch} · ${profile.totalRamGb}GB · ${profile.cpus} CPU · gpu=${plan.selection.gpu}`)
  console.log(`▸ Isolation: ${plan.selection.tier} via ${plan.selection.provider}`)
  console.log(`▸ Model ceiling: ${plan.selection.modelCeiling}`)
  console.log(`▸ Endpoint: ${plan.endpoint}`)
  console.log('▸ Plan:')
  plan.steps.forEach((s, i) => console.log(`   ${i + 1}. ${s}`))

  if (!execute) { console.log('\n(dry-run — pass --execute to run the native T2 path)\n'); return }

  if (plan.provisionMachine) {
    console.log('\n[bootstrap] T1 VM/container provisioning is handled by the Tauri shell (PM3d) — not run here.')
    return
  }
  if (plan.provisionRuntime) {
    console.log('\n[bootstrap] provisioning complete runtime…')
    await exec('node', ['--import', 'tsx', 'scripts/provision-runtime.ts'], { cwd: new URL('..', import.meta.url).pathname }).then((r) => process.stdout.write(r.stdout))
  }
  for (const m of plan.modelsToPull) {
    console.log(`[bootstrap] pulling ${m}…`)
    await pullModel(m, (status, pct) => { if (pct !== null && pct % 25 === 0) console.log(`   ${m} ${pct}%`) }).catch((e) => console.warn(`   pull ${m} failed: ${e}`))
  }
  console.log('\n[bootstrap] runtime + models ready. Launch the sandboxed runtime with: npm run start:managed-ollama\n')
}
main().catch((e) => { console.error('[bootstrap] error:', e instanceof Error ? e.message : e); process.exit(1) })
