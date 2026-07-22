import { test } from 'node:test'
import assert from 'node:assert/strict'
import { seatbeltProfile, resolveManagedOllamaBinary, buildLaunchRecipe, MANAGED_PORT } from './managed-ollama.js'

test('seatbelt profile is deny-default and confines writes to the app data dir', () => {
  const p = seatbeltProfile()
  assert.match(p, /\(deny default\)/)
  // writes restricted to ~/.noetica (not the whole home) — the real confinement
  assert.match(p, /allow file-write\*[\s\S]*\.noetica/)
  // must NOT grant blanket write to all of HOME
  assert.doesNotMatch(p, /allow file-write\* \(subpath \(param "HOME"\)\)/)
  // Metal headless compute needs these (validated empirically)
  assert.match(p, /allow mach-lookup/)
  assert.match(p, /allow iokit-open/)
})

test('binary resolution prefers explicit env, then app runtime dir', () => {
  assert.equal(resolveManagedOllamaBinary({ NOETICA_OLLAMA_BIN: '/custom/ollama' }), '/custom/ollama')
  const noEnv = resolveManagedOllamaBinary({})
  assert.match(String(noEnv), /\.noetica\/runtime\/ollama$/)
})

test('launch recipe uses sandbox-exec with the profile + isolated port/model dir', () => {
  const r = buildLaunchRecipe('/opt/homebrew/bin/ollama')
  assert.equal(r.cmd, 'sandbox-exec')
  assert.ok(r.args.includes('-f') && r.args.some((a) => a.endsWith('ollama.sb')))
  assert.ok(r.args.includes('serve'))
  assert.equal(r.env['OLLAMA_HOST'], `127.0.0.1:${MANAGED_PORT}`)
  assert.match(r.env['OLLAMA_MODELS']!, /\.noetica\/models$/)
})

test('launch recipe redirects the child HOME into the write-allowed app data dir (first-boot keygen)', () => {
  const r = buildLaunchRecipe('/opt/homebrew/bin/ollama')
  // Ollama generates $HOME/.ollama/id_ed25519 during serve init; with the real HOME the
  // seatbelt denies that mkdir and serve never comes up on a clean Mac. The child's HOME
  // must resolve inside ~/.noetica (already write-allowed by the profile)…
  assert.match(r.env['HOME']!, /\.noetica$/)
  // …while the PROFILE's allow-list root (-D HOME=) stays the REAL home, so the
  // (string-append (param "HOME") "/.noetica") write rule keeps pointing at ~/.noetica.
  const dParam = r.args[r.args.indexOf('-D') + 1]!
  assert.ok(dParam.startsWith('HOME=') && !dParam.includes('.noetica'))
})
