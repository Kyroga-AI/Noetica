import { test } from 'node:test'
import assert from 'node:assert/strict'
import { detectPreset, resolveConfig, applyPreset } from './presets.js'

test('detectPreset: RAM tiers (soft degradation on small boxes)', () => {
  assert.equal(detectPreset(8), 'lite')     // 8 GB box → no best-of-N, won't thrash
  assert.equal(detectPreset(16), 'balanced')
  assert.equal(detectPreset(64), 'max')
})

test('lite preset disables best-of-N (the soft-degrade that prevents 8GB thrash)', () => {
  const c = resolveConfig({ NOETICA_PRESET: 'lite' })
  assert.equal(c.bestOfN, 1)
  assert.equal(c.scK, 1)
  assert.equal(c.critic, false)
  assert.equal(c.execVerify, true)   // verified compute is cheap → stays ON even on lite
})

test('balanced preset enables best-of-3 + critic', () => {
  const c = resolveConfig({ NOETICA_PRESET: 'balanced' })
  assert.equal(c.bestOfN, 3)
  assert.equal(c.scK, 3)
  assert.equal(c.critic, true)
})

test('explicit env vars OVERRIDE the preset (power users keep control)', () => {
  const c = resolveConfig({ NOETICA_PRESET: 'lite', NOETICA_BESTOF_N: '5', NOETICA_MODEL: 'qwen3:14b' })
  assert.equal(c.bestOfN, 5)         // explicit wins over lite's 1
  assert.equal(c.model, 'qwen3:14b')
  assert.equal(c.scK, 1)             // unset → still lite default
})

test('applyPreset sets unset vars but never clobbers explicit ones', () => {
  const env: Record<string, string | undefined> = { NOETICA_PRESET: 'balanced', NOETICA_SC_K: '7' }
  applyPreset(env)
  assert.equal(env['NOETICA_SC_K'], '7')        // explicit preserved
  assert.equal(env['NOETICA_BESTOF_N'], '3')    // filled from preset
  assert.equal(env['NOETICA_CRITIC'], '1')      // filled from preset
})

test('NOETICA_CRITIC=0 explicit override survives applyPreset', () => {
  const env: Record<string, string | undefined> = { NOETICA_PRESET: 'max', NOETICA_CRITIC: '0' }
  applyPreset(env)
  assert.equal(env['NOETICA_CRITIC'], '0')
})
