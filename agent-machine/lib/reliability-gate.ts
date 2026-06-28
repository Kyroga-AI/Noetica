// reliability-gate — the POST-COUNCIL selective-prediction signal. Separate from canon-route (which routes
// BEFORE generation): this fires AFTER the council's arms have each produced a letter, and estimates how
// reliable that answer is — so the system can ANSWER on consensus and ESCALATE (→ verified-compute / abstain)
// on a coin-flip. It rests on two measured axes, neither of which needs the gold label:
//   • cross-arm AGREEMENT — how many arms (baseline/brain/rerank/ground/…) picked the same letter. The board
//     showed 4/4-unanimous ⇒ 73–79% correct, split ⇒ ~38%. The supervised axis.
//   • local DENSITY — is this a TYPICAL question? DBSCAN found the manifold is one continuous blob (no
//     clusters) but errors live in the sparse PERIPHERY: dense ⇒ ~73%, outlier ⇒ ~43%. The unsupervised axis.
// They STACK (measured 2×2): agree+dense ≈ 0.79, split+sparse ≈ 0.35. Calibration + reference manifold live in
// canon/reliability-reference.json, built by scripts/build-reliability-reference.py.
// PIT: the manifold and the agreement patterns drift as the brain evolves — REBUILD the reference per brain
// version (point-in-time calibration); a frozen gate goes stale like a through-the-cycle risk grade.
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const CANON = process.env['CANON_DIR'] || join(__dirname, '..', 'canon')

interface Calibration { agree_dense: number; agree_sparse: number; split_dense: number; split_sparse: number; overall: number }
interface Reference {
  features: string[]
  scaler: { mean: number[]; std: number[] }
  reference: number[][]
  density_k: number
  density_threshold: number
  calibration: Calibration
  answer_threshold: number
  model?: string
  family?: string
}

let _ref: Reference | null | undefined
function loadRef(): Reference | null {
  if (_ref !== undefined) return _ref
  // MODEL-AGNOSTIC: prefer the calibration keyed to the CURRENT model family (the 2×2 is model-dependent —
  // a different family has different agreement patterns). Fall back to the default if no per-family file.
  const family = (process.env['MMLU_MODEL'] || '').split(/[:\-/]/)[0]!.toLowerCase()
  for (const name of [family ? `reliability-reference.${family}.json` : '', 'reliability-reference.json']) {
    if (!name) continue
    try {
      const p = join(CANON, name)
      if (existsSync(p)) { _ref = JSON.parse(readFileSync(p, 'utf8')) as Reference; return _ref }
    } catch { /* try next */ }
  }
  _ref = null
  return _ref
}

/** Density features — TS-computable with NO embedder: log10(max magnitude), log1p(word count), has-number.
 *  These are the cheap surface signals on which the reference manifold's local density is measured. */
function densityFeatures(question: string): number[] {
  const nums = (question.match(/(?<![A-Za-z_])\d+(?:\.\d+)?/g) ?? []).map((x) => Math.abs(Number(x))).filter((x) => x > 0)
  const maxMag = nums.length ? Math.log10(Math.max(...nums)) : 0
  const qLen = Math.log1p(question.trim().split(/\s+/).filter(Boolean).length)
  const hasNum = /(?<![A-Za-z_])\d/.test(question) ? 1 : 0
  return [maxMag, qLen, hasNum]
}

export interface GateResult {
  confidence: number               // calibrated P(correct) for this question (from the measured 2×2)
  decision: 'answer' | 'escalate'  // escalate ⇒ hand to verified-compute / abstain / human
  agreement: number                // fraction of arms on the modal answer
  agreeCount: number
  nArms: number
  modal: string | null             // the consensus letter
  typical: boolean                 // dense (typical) vs sparse (outlier) in the reference manifold
  reasons: string[]
}

/**
 * The reliability gate. `preds` = the council arms' letters, e.g. ['A','A','C','A'] (nulls/abstains dropped).
 * Returns a calibrated confidence + an answer/escalate decision. Falls back to raw agreement if the reference
 * artifact is absent (so it degrades gracefully before the first build-reliability-reference run).
 */
export function reliabilityGate(question: string, preds: Array<string | null | undefined>): GateResult {
  const ref = loadRef()
  const arms = preds.filter((p): p is string => !!p)
  const counts = new Map<string, number>()
  for (const p of arms) counts.set(p, (counts.get(p) ?? 0) + 1)
  let modal: string | null = null
  let best = 0
  for (const [k, v] of counts) if (v > best) { best = v; modal = k }
  const nArms = arms.length || 1
  const agreement = best / nArms
  const unanimous = arms.length >= 2 && best === arms.length

  let typical = true
  if (ref) {
    const f = densityFeatures(question)
    const z = f.map((x, i) => (x - ref.scaler.mean[i]!) / ref.scaler.std[i]!)
    const dists = ref.reference.map((r) => Math.sqrt(r.reduce((s, ri, i) => s + (ri - z[i]!) ** 2, 0)))
    dists.sort((a, b) => a - b)
    const k = ref.density_k
    const dens = dists.slice(1, k + 1).reduce((s, d) => s + d, 0) / k   // skip self (dist 0)
    typical = dens <= ref.density_threshold
  }

  const cal = ref?.calibration
  let confidence = cal?.overall ?? agreement
  if (cal) {
    confidence = unanimous ? (typical ? cal.agree_dense : cal.agree_sparse)
                           : (typical ? cal.split_dense : cal.split_sparse)
  }
  const threshold = ref?.answer_threshold ?? 0.6
  const decision: 'answer' | 'escalate' = confidence >= threshold ? 'answer' : 'escalate'
  const reasons = [
    `${best}/${nArms} arms agree${unanimous ? ' (unanimous)' : ' (split)'}`,
    typical ? 'typical (dense) question' : 'atypical (outlier) question',
    `calibrated P(correct)≈${confidence.toFixed(2)} → ${decision}`,
  ]
  return { confidence, decision, agreement, agreeCount: best, nArms, modal, typical, reasons }
}

// CLI self-test:  npx tsx lib/reliability-gate.ts
if (process.argv[1] && process.argv[1].endsWith('reliability-gate.ts')) {
  const cases: Array<[string, string[]]> = [
    ['What is the central limit theorem?', ['B', 'B', 'B', 'B']],                                   // agree + typical
    ['Compute the eigenvalues of the 9500 N·m operator D acting on x^7 + 3x^2', ['A', 'C', 'B', 'D']], // split + outlier
    ['Find the order of the element 7 in Z_20 under addition', ['C', 'C', 'A', 'C']],                // 3/4 split
  ]
  for (const [q, preds] of cases) {
    const g = reliabilityGate(q, preds)
    console.log(`\nQ: ${q.slice(0, 64)}`)
    console.log(`   preds=[${preds.join(',')}] → modal=${g.modal} conf=${g.confidence.toFixed(2)} decision=${g.decision.toUpperCase()}`)
    console.log(`   ${g.reasons.join('  ·  ')}`)
  }
}
