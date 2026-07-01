/**
 * verified-vs-raw.ts — apples-to-apples test of the neurosymbolic moat vs the raw
 * neural floor, on the same MMLU items.
 *
 *   RAW   : single-shot MCQ on the base model (what we measured at 60%)
 *   MOAT  : (1) buildQuestionContext — KB vector + graph + episodic enrichment,
 *           (2) verified reasoning — the model writes a Python program to solve it,
 *               which we EXECUTE (sympy/numpy), deriving the answer from computation
 *               rather than mental arithmetic (catches errors like "4 = 2√2"),
 *           (3) episodic write-back of the outcome.
 *
 * Usage: VR_SUBJECT=college_mathematics VR_N=5 tsx scripts/verified-vs-raw.ts
 */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { execFile } from 'node:child_process'
import { setOllamaBase } from '../lib/ollama.js'
import { buildQuestionContext, recordEpisodeOutcome, episodeCount } from '../lib/question-context.js'
import { buildVerifiedAnswerArtifact, writeProofArtifact, proofArtifactCount } from '../lib/proof-fabric.js'
import { classifyComplexity, calibratedConfidence, modelForPosture } from '../lib/complexity-discipline.js'
import { extractCode } from '../lib/exec-verify.js'

const BANK = path.join(os.homedir(), '.noetica', 'corpus', 'benchmarks', 'mmlu_stem.json')
const BASE = process.env['OLLAMA_HOST']?.replace(/\/$/, '') || 'http://127.0.0.1:11435'
const RAW_MODEL = process.env['VR_RAW_MODEL'] || 'qwen2.5:7b-cpu'
const CODE_MODEL = process.env['VR_CODE_MODEL'] || 'qwen2.5-coder:7b-cpu'
const SUBJECT = process.env['VR_SUBJECT'] || 'college_mathematics'
const N = Number(process.env['VR_N'] || 5)
const TIMEOUT = Number(process.env['VR_TIMEOUT_MS'] || 240_000)
const L = ['A', 'B', 'C', 'D']

async function ask(model: string, sys: string, user: string): Promise<string> {
  try {
    const r = await fetch(`${BASE}/v1/chat/completions`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, stream: false, messages: [{ role: 'system', content: sys }, { role: 'user', content: user }] }),
      signal: AbortSignal.timeout(TIMEOUT),
    })
    const d = await r.json() as { choices?: Array<{ message?: { content?: string } }> }
    return (d.choices?.[0]?.message?.content || '').trim()
  } catch { return '' }
}
const letter = (s: string) => (/FINAL:\s*([A-D])/i.exec(s)?.[1] || /\b([A-D])\b(?![\s\S]*\b[A-D]\b)/.exec(s.trim())?.[1] || '').toUpperCase()

function runPython(code: string): Promise<string> {
  return new Promise((resolve) => {
    const tmp = path.join(os.tmpdir(), `vr_${Date.now()}_${Math.random().toString(36).slice(2)}.py`)
    fs.writeFileSync(tmp, code)
    const cp = execFile('python3', [tmp], { timeout: 20_000 }, (_e, so) => { try { fs.unlinkSync(tmp) } catch {} ; resolve((so || '').trim()) })
    cp.on('error', () => resolve(''))
  })
}

async function rawArm(q: any): Promise<string> {
  const prompt = `${q.question}\n\n${q.choices.map((c: string, i: number) => `${L[i]}. ${c}`).join('\n')}`
  return letter(await ask(RAW_MODEL, 'Multiple-choice exam. Reason briefly, end with "FINAL: X".', prompt))
}

async function moatArm(q: any): Promise<string> {
  const ctx = await buildQuestionContext(q.question)
  const verdict = classifyComplexity(q.question)
  // Posture-driven model: the coder loads ONLY for genuine 'code' context; math
  // (compute posture) uses the general model to write the program. No 2nd model.
  const cpu = (process.env['NOETICA_FORCE_CPU'] === '1' || process.env['VR_CODE_MODEL']?.endsWith('-cpu'))
  const solveModel = verdict.posture === 'code'
    ? CODE_MODEL
    : modelForPosture(verdict.posture) + (cpu ? '-cpu' : '')
  const prompt = `${q.question}\n\n${q.choices.map((c: string, i: number) => `${L[i]}. ${c}`).join('\n')}${ctx.grounding}\n\n` +
    `Write a self-contained Python program (use sympy/numpy if useful) that computes the answer and prints exactly one line: "ANSWER: X" where X is the correct choice letter. Output ONLY a \`\`\`python code block.`
  const out = await ask(solveModel, 'You are a careful computational mathematician. Solve by writing correct Python.', prompt)
  // was a duplicate, same-bug-class inline regex (silently dropped a truncated/unclosed code block as "no
  // code" instead of recovering it, LOSING a verified-compute answer to the raw-MCQ fallback below). Reuse
  // the shared, fixed extractor instead of a 3rd copy of this logic.
  const code = extractCode(out) ?? ''
  let ans = '', verified = false
  if (code.trim()) { const printed = await runPython(code); ans = (/ANSWER:\s*([A-D])/i.exec(printed)?.[1] || letter(printed)).toUpperCase(); verified = !!ans }
  // Robust fallback: if code-exec yielded nothing, answer the MCQ *with grounding*
  // (still better than raw — it keeps the KB context), never return empty.
  if (!ans) {
    ans = letter(out) // the codegen response sometimes states the letter
    if (!ans) ans = letter(await ask(RAW_MODEL, 'Multiple-choice exam. Reason briefly, end with "FINAL: X".', `${q.question}\n\n${q.choices.map((c: string, i: number) => `${L[i]}. ${c}`).join('\n')}${ctx.grounding}`))
  }
  void verified
  const correct = ans === L[q.answer]
  recordEpisodeOutcome(ctx.episodeId, { answer: ans, correct, lane: 'verified+enriched' })
  // Pillar C: calibrated confidence + non-claims from the posture (verdict above)
  const confidence = calibratedConfidence(verdict, { codeVerified: verified, grounded: ctx.recalled.length > 0 })
  // PFK certificate (Pillar B): every verified answer emits a proof artifact
  const artifact = buildVerifiedAnswerArtifact({
    question: q.question, answer: ans,
    method: verified ? 'code-executed' : 'fallback',
    computation: code.trim() || undefined,
    confidence,
    primeSignature: ctx.primeSignature, episodeId: ctx.episodeId,
    groundingRefs: ctx.recalled.map((r) => r.label),
  })
  artifact.non_claim_boundary.push(...verdict.nonClaims)
  artifact['complexity_posture'] = verdict.posture
  artifact['morphology'] = verdict.morphology
  writeProofArtifact(artifact)
  return ans
}

async function main() {
  setOllamaBase(BASE)
  const items = (JSON.parse(fs.readFileSync(BANK, 'utf8')) as Record<string, any[]>)[SUBJECT].slice(0, N)
  console.log(`# Verified+Enriched vs Raw — ${SUBJECT}, ${N} items\n  raw=${RAW_MODEL}  code=${CODE_MODEL}\n`)
  let raw = 0, moat = 0
  for (const q of items) {
    const gold = L[q.answer]
    const r = await rawArm(q); const m = await moatArm(q)
    if (r === gold) raw++; if (m === gold) moat++
    console.log(`  gold=${gold} | raw=${r}${r === gold ? '✓' : '✗'} | moat=${m}${m === gold ? '✓' : '✗'}`)
  }
  console.log(`\n## RAW (neural floor):        ${raw}/${N}  (${Math.round(100 * raw / N)}%)`)
  console.log(`## MOAT (verified+enriched):  ${moat}/${N}  (${Math.round(100 * moat / N)}%)`)
  console.log(`## Δ = ${moat - raw >= 0 ? '+' : ''}${moat - raw} items  | episodes in KG: ${episodeCount()} | proof artifacts: ${proofArtifactCount()}`)
  const out = { subject: SUBJECT, n: N, raw, moat, delta: moat - raw, raw_model: RAW_MODEL, code_model: CODE_MODEL, generated_at: new Date().toISOString() }
  const p = path.join(os.homedir(), '.noetica', `verified-vs-raw-${Date.now()}.json`)
  fs.writeFileSync(p, JSON.stringify(out, null, 2)); console.log(`\nReport: ${p}`)
}
void main()
