/**
 * presets — collapse the 100+ NOETICA_* knobs into ONE choice: a RAM-aware preset.
 *
 * The #1 ergonomics gap (audit 2026-06-27): power without ergonomics — every lever exposed, none defaulted.
 * A user shouldn't need to know NOETICA_BESTOF_N / NOETICA_SC_K / NOETICA_CRITIC to get a sane setup. They pick
 * (or we auto-detect) a preset; explicit env vars still win, so nothing existing breaks.
 *
 * It ALSO gives soft memory degradation — the thing that crashed this box repeatedly: a small box auto-selects
 * `lite` (no best-of-N, low tokens), so we never thrash a 7B + sympy subprocesses + best-of-3 on 8 GB.
 */
import * as os from 'node:os'

export type Preset = 'lite' | 'balanced' | 'max'

export interface NoeticaConfig {
  preset: Preset
  model: string
  bestOfN: number          // NOETICA_BESTOF_N — out-loop deliberation samples (1 = off)
  scK: number              // NOETICA_SC_K — reason-lane self-consistency samples
  critic: boolean          // NOETICA_CRITIC — best-of-N critic select
  execVerify: boolean      // NOETICA_EXEC_VERIFY — program-of-thought verified compute
  reasonLane: boolean      // NOETICA_REASON_LANE — no-retrieval CoT+SC for math/reasoning
  groundingSignal: boolean // NOETICA_GROUNDING_SIGNAL — consume canonRoute grounding
  maxTokens: number        // NOETICA_MAX_TOKENS
}

// The knob->preset map. lite is deliberately CHEAP so an 8 GB box doesn't thrash.
const PRESETS: Record<Preset, Omit<NoeticaConfig, 'preset'>> = {
  lite:     { model: 'qwen2.5:7b', bestOfN: 1, scK: 1, critic: false, execVerify: true, reasonLane: true, groundingSignal: true, maxTokens: 512 },
  balanced: { model: 'qwen2.5:7b', bestOfN: 3, scK: 3, critic: true,  execVerify: true, reasonLane: true, groundingSignal: true, maxTokens: 768 },
  max:      { model: 'qwen3:14b',  bestOfN: 5, scK: 5, critic: true,  execVerify: true, reasonLane: true, groundingSignal: true, maxTokens: 1024 },
}

/** Pick a preset from available RAM. <12 GB → lite (no best-of-N), <28 GB → balanced, else max. */
export function detectPreset(totalRamGb: number = os.totalmem() / 1e9): Preset {
  if (totalRamGb < 12) return 'lite'
  if (totalRamGb < 28) return 'balanced'
  return 'max'
}

const bool = (v: string | undefined, d: boolean): boolean => (v == null ? d : v !== '0')
const int = (v: string | undefined, d: number): number => {
  const n = Number(v); return v != null && Number.isFinite(n) ? n : d
}

/**
 * Resolve the effective config: start from the chosen/auto-detected preset, then let any EXPLICIT env var
 * override it (so power users and existing setups keep full control). NOETICA_PRESET selects the preset.
 */
export function resolveConfig(env: Record<string, string | undefined> = process.env): NoeticaConfig {
  const preset = (['lite', 'balanced', 'max'] as const).includes(env['NOETICA_PRESET'] as Preset)
    ? (env['NOETICA_PRESET'] as Preset)
    : detectPreset()
  const b = PRESETS[preset]
  return {
    preset,
    model:           env['NOETICA_MODEL'] ?? b.model,
    bestOfN:         int(env['NOETICA_BESTOF_N'], b.bestOfN),
    scK:             int(env['NOETICA_SC_K'], b.scK),
    critic:          bool(env['NOETICA_CRITIC'], b.critic),
    execVerify:      bool(env['NOETICA_EXEC_VERIFY'], b.execVerify),
    reasonLane:      bool(env['NOETICA_REASON_LANE'], b.reasonLane),
    groundingSignal: bool(env['NOETICA_GROUNDING_SIGNAL'], b.groundingSignal),
    maxTokens:       int(env['NOETICA_MAX_TOKENS'], b.maxTokens),
  }
}

/**
 * Apply the resolved preset to the environment: set each NOETICA_* var that ISN'T already explicitly set, so
 * the rest of the (env-reading) codebase transparently gets sane preset defaults. Idempotent; explicit wins.
 * Call once at startup. Returns the resolved config for logging.
 */
export function applyPreset(env: Record<string, string | undefined> = process.env): NoeticaConfig {
  const c = resolveConfig(env)
  const set = (k: string, v: string) => { if (env[k] == null) env[k] = v }
  set('NOETICA_MODEL', c.model)
  set('NOETICA_BESTOF_N', String(c.bestOfN))
  set('NOETICA_SC_K', String(c.scK))
  set('NOETICA_CRITIC', c.critic ? '1' : '0')
  set('NOETICA_EXEC_VERIFY', c.execVerify ? '1' : '0')
  set('NOETICA_REASON_LANE', c.reasonLane ? '1' : '0')
  set('NOETICA_GROUNDING_SIGNAL', c.groundingSignal ? '1' : '0')
  set('NOETICA_MAX_TOKENS', String(c.maxTokens))
  return c
}

/** One-line human summary for the doctor / startup log. */
export function summarize(c: NoeticaConfig, ramGb: number = os.totalmem() / 1e9): string {
  const warn = ramGb < 6 ? '  ⚠ <6GB: even lite may swap — use a smaller model' : ''
  return `preset=${c.preset} (${ramGb.toFixed(0)}GB RAM) · model=${c.model} · best-of-${c.bestOfN} · SC=${c.scK} · ` +
    `critic=${c.critic ? 'on' : 'off'} · verified-compute=${c.execVerify ? 'on' : 'off'} · reason-lane=${c.reasonLane ? 'on' : 'off'}${warn}`
}
