/**
 * reasoning-benchmark — emit the 5th SourceOS reasoning contract, `ReasoningBenchmark`,
 * for each MMLU board run, so a board is itself spec-conformant, replayable evidence on the
 * SAME canonical schemas TurtleTerm/Noetica already speak (ReasoningRun/Event/Receipt/ReplayPlan).
 *
 * A board run is a benchmark: per-arm accuracy over a set of MMLU subjects at a fixed seed/model.
 * We materialise that as one `ReasoningBenchmark` (suite + assertions + verdict + capturedAt),
 * tied to a real ReasoningRun (runRef) opened+closed via reasoning-evidence so the benchmark
 * references genuine run/receipt evidence rather than a synthetic id.
 *
 * Authority: /Users/michaelheller/dev/sourceos-spec/schemas/ReasoningBenchmark.json
 *   required: id,type,specVersion,runRef,suite,passed,assertions,capturedAt
 *   id      ~ ^urn:srcos:reasoning-benchmark:
 *   runRef  ~ ^urn:srcos:reasoning-run:
 *   type    = "ReasoningBenchmark"  (const)
 *
 * Exception-safe: a benchmark-emit failure must NEVER break the board (wrap, warn, continue).
 * Dependency-light: node crypto + fs only, reusing the reasoning-evidence sink convention.
 */
import { randomBytes } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { openReasoningRun, emitReasoningEvent, closeReasoningRun } from './reasoning-evidence'

const SPEC_VERSION = '2.0.0'
const BENCHMARK_PREFIX = 'urn:srcos:reasoning-benchmark:'

function sink(): string {
  return process.env['SOURCEOS_REASONING_EVIDENCE'] || join(homedir(), '.noetica', 'reasoning')
}
function hex(bytes = 16): string { return randomBytes(bytes).toString('hex') }
function nowIso(): string { return new Date().toISOString() }
function pct(c: number, n: number): number { return n > 0 ? Math.round((1000 * c) / n) / 10 : 0 }

export interface ArmTally { c: number; n: number; a?: number }

export interface BenchmarkResult {
  /** arm → {c: correct, n: attempted, a: arm-fired (e.g. compute)} */
  totals: Record<string, ArmTally>
  arms: string[]
  subjects: string[]
  model: string
  seed: number
  /** optional extras (additionalProperties allowed by the schema) */
  perSubject?: number
  k?: number
}

export interface ReasoningBenchmark {
  id: string
  type: 'ReasoningBenchmark'
  specVersion: string
  runRef: string
  suite: string
  passed: boolean
  assertions: Array<{ name: string; passed: boolean; summary?: string; [k: string]: unknown }>
  capturedAt: string
  [k: string]: unknown
}

/**
 * Build a conformant ReasoningBenchmark from board totals and write it to the reasoning sink as
 * <sink>/benchmarks/<benchHex>.json. One assertion per arm: passes if that arm answered every
 * attempted question (n>0 and no missing attempts) — i.e. the arm produced a verdict it can be
 * graded on. The overall `passed` is true iff every arm produced gradable verdicts. Per-arm
 * accuracy is carried as extra fields on each assertion (additionalProperties allowed).
 *
 * Best-effort: never throws — returns the record on success, or undefined on failure.
 */
export function emitReasoningBenchmark(result: BenchmarkResult): ReasoningBenchmark | undefined {
  try {
    const arms = result.arms ?? Object.keys(result.totals ?? {})
    const subjects = result.subjects ?? []
    const model = result.model ?? 'unknown'
    const seed = Number.isFinite(result.seed) ? result.seed : 0

    // Tie the benchmark to a real ReasoningRun so runRef references genuine evidence.
    const run = openReasoningRun(`mmlu-board model=${model} seed=${seed}`, undefined)
    emitReasoningEvent(run, {
      eventType: 'noetica.benchmark.board',
      summary: `MMLU board: arms=[${arms.join(', ')}] subjects=${subjects.length} model=${model} seed=${seed}`,
      trustLevel: 'trusted-workspace-source',
      extra: { armCount: arms.length, subjectCount: subjects.length },
    })

    const assertions = arms.map((arm) => {
      const t = result.totals?.[arm] ?? { c: 0, n: 0 }
      const accuracy = pct(t.c, t.n)
      const graded = t.n > 0
      return {
        name: `arm:${arm}`,
        passed: graded,
        summary: `${arm} — ${t.c}/${t.n} correct (${accuracy}%)${t.a != null ? ` · fired ${t.a}` : ''}`,
        arm,
        correct: t.c,
        attempted: t.n,
        accuracy,
        ...(t.a != null ? { fired: t.a } : {}),
      }
    })
    const passed = assertions.length > 0 && assertions.every((a) => a.passed)

    const benchHex = hex()
    const benchmark: ReasoningBenchmark = {
      id: BENCHMARK_PREFIX + benchHex,
      type: 'ReasoningBenchmark',
      specVersion: SPEC_VERSION,
      runRef: run.id,
      suite: 'mmlu-brain-bench',
      passed,
      assertions,
      capturedAt: nowIso(),
      // useful extras (additionalProperties: true)
      model,
      seed,
      subjects,
      arms,
      ...(result.perSubject != null ? { perSubject: result.perSubject } : {}),
      ...(result.k != null ? { k: result.k } : {}),
    }

    closeReasoningRun(run, {
      status: 'completed',
      replayClass: 'evidence-only',
      coordination: { benchmarkRef: benchmark.id, suite: 'mmlu-brain-bench' },
    })

    const dir = join(sink(), 'benchmarks')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, `${benchHex}.json`), JSON.stringify(benchmark, null, 2))
    return benchmark
  } catch (err) {
    console.warn('[reasoning-benchmark] emitReasoningBenchmark failed:', err instanceof Error ? err.message : String(err))
    return undefined
  }
}
