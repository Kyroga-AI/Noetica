// operation-router — the OPERATION axis of routing (orthogonal to canon-route's TOPIC axis). The session's
// trimodal finding: a question's MODE (compute / lookup / evaluate) lives in its SYMBOLS and STRUCTURE
// (numbers, equations, "value of", statement-lists), NOT its verbs/topic — and the operation manifold is
// asymmetric: `evaluate` is a clean island (deterministic rule, ~100%), while `compute` vs `lookup` overlap
// (the hard boundary, where confidence is low → fall to brain-grounding). This returns {mode, subMode, tool,
// confidence} with NO LLM call, so the dispatch is deterministic and auditable.
const NUM = /(?<![A-Za-z_])\d+(?:\.\d+)?/g
const EVAL_STRUCT = /statement 1|statement 2|\bwhich\b.{0,70}\b(true|false|correct|cannot|must|necessarily)\b/i
const MULTI_STMT = /statement 1|statement 2|\bi\.\b.{0,90}\bii\.\b/i
const COMPUTE_CUE = /\b(calculate|compute|solve|determine|derive|evaluate)\b|\bfind (the|all|an?)\b|\b(value of|how many|how much|number of|probability|the sum|the product|the area|the volume|the distance|the order of)\b/i
const HAS_EQ = /=|\^|sqrt|√|∫|∑|\bmod\b/i
const UNITS = /\b(kg|mol|cm|mm|nm|km|m\/s|hz|atm|ml|joules?|newtons?|volts?|amps?|watts?|degrees?|kelvin|grams?|moles?|liters?|meters?|seconds?)\b/i
const PROB_STATS = /\b(probability|expected|variance|deviation|distribution|mean|sample|random|percentile|confidence)\b/i
const SELECT = /which of the following is (a|an|the|not|most|best|least)\b/i
const DEFINE = /\b(what is|defined as|definition|best describes|refers to|known as|called)\b/i

export type Mode = 'compute' | 'lookup' | 'evaluate'
export type Tool = 'sympy' | 'stats' | 'glossary' | 'consistency' | 'retrieve'
export interface OpRoute {
  mode: Mode
  subMode: string
  tool: Tool
  confidence: number       // calibrated-ish; LOW on the compute/lookup overlap → escalate to grounding
  deterministic: boolean   // true when the eval-rule fired (the clean island)
}

/** Classify a question's OPERATION (no generation). Pairs with canonRoute (topic) — the two axes are orthogonal. */
export function operationRoute(question: string): OpRoute {
  const nNum = (question.match(NUM) || []).length
  // ① evaluate — the clean deterministic island
  if (EVAL_STRUCT.test(question)) {
    const sub = MULTI_STMT.test(question) ? 'multi-statement' : 'which-is-true'
    return { mode: 'evaluate', subMode: sub, tool: 'consistency', confidence: 0.92, deterministic: true }
  }
  // ② compute — number/equation/imperative-to-produce
  const computeish = COMPUTE_CUE.test(question) || HAS_EQ.test(question) || UNITS.test(question) || nNum >= 2
  if (computeish) {
    const sub = PROB_STATS.test(question) ? 'prob/stats'
      : (nNum >= 2 || HAS_EQ.test(question)) ? 'numeric/plug-in' : 'set-up & derive'
    const tool: Tool = sub === 'prob/stats' ? 'stats' : 'sympy'
    // the compute/lookup overlap: bare "find/determine" with no number/eq is the soft boundary → lower confidence
    const soft = sub === 'set-up & derive'
    return { mode: 'compute', subMode: sub, tool, confidence: soft ? 0.55 : 0.78, deterministic: false }
  }
  // ③ lookup — recall/select a fact
  const sub = SELECT.test(question) ? 'select-which' : DEFINE.test(question) ? 'define/recall' : 'bare-identify'
  return { mode: 'lookup', subMode: sub, tool: 'glossary', confidence: sub === 'bare-identify' ? 0.6 : 0.75, deterministic: false }
}

// CLI self-test:  npx tsx lib/operation-router.ts
if (process.argv[1] && process.argv[1].endsWith('operation-router.ts')) {
  for (const q of [
    'Calculate the molarity of 0.5 mol NaCl in 2.0 L of solution',
    'Statement 1 | Every field is a ring. Statement 2 | Z_5 is a field. Which is true?',
    'Which of the following is an example of a prokaryotic cell?',
    'What is the central limit theorem?',
    'Find the area enclosed by the curve',
  ]) {
    const r = operationRoute(q)
    console.log(`${r.mode}/${r.subMode} → ${r.tool}  conf=${r.confidence}${r.deterministic ? ' (det)' : ''}  ::  ${q.slice(0, 50)}`)
  }
}
