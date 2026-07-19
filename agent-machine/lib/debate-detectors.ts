/**
 * debate-detectors — the deterministic, versioned, hashed first-pass detector library for the Debater
 * agent (spec §2). This is the piece that was genuinely absent: a set of LOGFALL.* (logical fallacy) and
 * COGBIAS.* (cognitive bias) classifiers that scan a claim's text and produce a DETERMINISTIC score +
 * span + rationale per firing.
 *
 * KEY ARCHITECTURAL POINT (spec §2, the "two-pass intent"): detectors do NOT fire warn/block. They
 * produce evidence that feeds the MLN reasoner (lib/reasoner.ts), which composes it into a severity via
 * MAP inference. So these can be honest, imperfect heuristic first-pass detectors — a false-positive
 * here is a weak negative-weight input the reasoner can be outvoted on by grounded evidence, NOT a
 * spurious block. That is the whole reason the deterministic layer stays deterministic and separate.
 *
 * HONESTY: these are surface heuristics (lexical/structural cues), not trained classifiers. They catch
 * the obvious cases and will miss subtle ones and mis-fire on some (e.g. a quote OF a fallacy). That is
 * acceptable and by design — the reasoner + grounded-evidence layer is what makes the system robust to
 * detector noise. Do not present detector output as ground truth; it is one evidence stream.
 */
import { createHash } from 'node:crypto'

export interface DetectorHit {
  ruleId: string          // e.g. 'LOGFALL.STRAWMAN.V1'
  score: number           // deterministic, in [0,1]
  span: string            // the matched text span (rationale anchor)
  rationale: string       // why it fired
}

interface Detector {
  ruleId: string
  family: 'LOGFALL' | 'COGBIAS'
  /** Deterministic scorer. Returns a hit (or null). Must be pure — same input, same output, always. */
  run(text: string): DetectorHit | null
}

/** Helper: first regex match's text (the span), or null. */
function firstMatch(text: string, re: RegExp): string | null {
  const m = re.exec(text)
  return m ? m[0] : null
}

// ─── LOGFALL: logical-fallacy detectors ────────────────────────────────────────────────────────────────

const DETECTORS: Detector[] = [
  {
    ruleId: 'LOGFALL.STRAWMAN.V1', family: 'LOGFALL',
    run(t) {
      // misrepresentation cue: "so you're saying" / "what you really mean" + an absolute (always/never/all)
      const cue = firstMatch(t, /\b(so (you'?re|you are) saying|what you (really )?mean is|your (whole )?argument is that)\b/i)
      const absolute = /\b(always|never|all|every|no one|everyone|nothing)\b/i.test(t)
      if (cue && absolute) return { ruleId: this.ruleId, score: 0.8, span: cue, rationale: 'restatement cue + absolutizing quantifier (misrepresentation)' }
      if (cue) return { ruleId: this.ruleId, score: 0.45, span: cue, rationale: 'restatement cue without absolute (weak strawman signal)' }
      return null
    },
  },
  {
    ruleId: 'LOGFALL.ADHOMINEM.V1', family: 'LOGFALL',
    run(t) {
      const span = firstMatch(t, /\b(you'?re (just |simply )?(an? )?(idiot|fool|liar|shill|hypocrite|clueless|ignorant)|typical of (someone|people) like you|of course you'?d say that)\b/i)
      return span ? { ruleId: this.ruleId, score: 0.75, span, rationale: 'attack on the person rather than the argument' } : null
    },
  },
  {
    ruleId: 'LOGFALL.SLIPPERYSLOPE.V1', family: 'LOGFALL',
    run(t) {
      // chain-of-consequence: "if we X, then Y, then Z" or "next thing you know"
      const span = firstMatch(t, /\b(next thing you know|before (you|we) know it|it'?s a slippery slope|leads? inevitably to|will (eventually|inevitably) (lead|result) in)\b/i)
      if (span) return { ruleId: this.ruleId, score: 0.65, span, rationale: 'unsupported chain of escalating consequences' }
      const ifThen = (t.match(/\bif .+ then\b/gi) ?? []).length
      if (ifThen >= 2) return { ruleId: this.ruleId, score: 0.5, span: 'multiple if…then chain', rationale: 'stacked conditional chain (possible slippery slope)' }
      return null
    },
  },
  {
    ruleId: 'LOGFALL.FALSEDICHOTOMY.V1', family: 'LOGFALL',
    run(t) {
      const span = firstMatch(t, /\b(either .+ or (else )?.+|you'?re (either )?(with us|against us)|there are only two (options|choices|kinds)|it'?s (either )?.+ or nothing)\b/i)
      return span ? { ruleId: this.ruleId, score: 0.6, span, rationale: 'framed as only two options when more exist' } : null
    },
  },
  {
    ruleId: 'LOGFALL.HASTYGEN.V1', family: 'LOGFALL',
    run(t) {
      // sweeping generalization from anecdote: absolute quantifier + a small-sample or anecdotal cue
      const absolute = firstMatch(t, /\b(all|every|always|never|no one|everyone|nobody)\b/i)
      const anecdote = /\b(i (know|met|saw) (a|one|some)|my (friend|cousin|neighbor)|this one time|in my experience)\b/i.test(t)
      if (absolute && anecdote) return { ruleId: this.ruleId, score: 0.7, span: absolute, rationale: 'sweeping quantifier generalized from an anecdote' }
      if (absolute) return { ruleId: this.ruleId, score: 0.3, span: absolute, rationale: 'absolute quantifier (weak over-generalization signal)' }
      return null
    },
  },
  {
    ruleId: 'LOGFALL.APPEALAUTHORITY.V1', family: 'LOGFALL',
    run(t) {
      // appeal to unnamed/vague authority (named + cited authority is fine; this targets the vague kind)
      const span = firstMatch(t, /\b(experts (say|agree|all agree)|scientists (say|agree)|studies show|it'?s (well[- ]?known|common knowledge)|everyone knows)\b/i)
      // downweight if a citation-like token is nearby (a real reference reduces the fallacy signal)
      const cited = /\b(20\d\d|et al\.|doi:|https?:\/\/|\[\d+\])\b/i.test(t)
      if (span) return { ruleId: this.ruleId, score: cited ? 0.25 : 0.55, span, rationale: cited ? 'appeal to authority but a citation is present (weak)' : 'appeal to vague/uncited authority' }
      return null
    },
  },
  {
    ruleId: 'LOGFALL.TUQUOQUE.V1', family: 'LOGFALL',
    run(t) {
      // whataboutism: deflecting a critique by pointing to the accuser's own conduct
      const span = firstMatch(t, /\b(what about (when |your )|but you (also |too )|you'?re one to talk|look who'?s talking|hypocritical of you to)\b/i)
      return span ? { ruleId: this.ruleId, score: 0.6, span, rationale: 'deflection to the accuser rather than answering the point (whataboutism)' } : null
    },
  },
  {
    ruleId: 'LOGFALL.BANDWAGON.V1', family: 'LOGFALL',
    run(t) {
      const span = firstMatch(t, /\b(everyone('?s| is) (doing|using|says)|the majority (of people )?(agree|believe)|most people (know|agree|think)|it'?s (the )?popular (opinion|choice)|nobody (else )?(disagrees|questions))\b/i)
      return span ? { ruleId: this.ruleId, score: 0.5, span, rationale: 'appeal to popularity rather than merit (bandwagon)' } : null
    },
  },
  {
    ruleId: 'LOGFALL.APPEALEMOTION.V1', family: 'LOGFALL',
    run(t) {
      const span = firstMatch(t, /\b(think of the children|how would you feel if|you'?d be heartless to|only a monster would|imagine the (suffering|pain|horror)|if you (really )?cared)\b/i)
      return span ? { ruleId: this.ruleId, score: 0.55, span, rationale: 'appeal to emotion in place of an argument' } : null
    },
  },
  {
    ruleId: 'LOGFALL.CIRCULAR.V1', family: 'LOGFALL',
    run(t) {
      // begging the question: conclusion restated as its own premise
      const span = firstMatch(t, /\b(it'?s true because it'?s true|because (that'?s )?(just )?the way it is|by definition it must be|which proves my point that|it works because it works)\b/i)
      return span ? { ruleId: this.ruleId, score: 0.65, span, rationale: 'conclusion assumed in its own premise (circular)' } : null
    },
  },
  {
    ruleId: 'LOGFALL.SUNKCOST.V1', family: 'LOGFALL',
    run(t) {
      const span = firstMatch(t, /\b(we'?ve (already )?(come|invested|spent) (too far|too much|so much)|can'?t (stop|quit) now after|would be a waste of (all )?(the|our) (time|money|effort) (we'?ve )?(already )?(spent|put in))\b/i)
      return span ? { ruleId: this.ruleId, score: 0.5, span, rationale: 'past investment used to justify continuing (sunk cost)' } : null
    },
  },
  {
    ruleId: 'LOGFALL.FALSECAUSE.V1', family: 'LOGFALL',
    run(t) {
      // post hoc: temporal sequence asserted as causation
      const span = firstMatch(t, /\b(ever since .+ (happened|started|began).+(so|therefore|which means)|right after .+ (came|took over|started).+ (improved|got worse|changed)|correlat\w+ (so|therefore|proves) caus)\b/i)
      if (span) return { ruleId: this.ruleId, score: 0.55, span, rationale: 'temporal sequence asserted as causation (post hoc)' }
      const simple = firstMatch(t, /\b(after .+, (so|therefore) .+ caused|because .+ came first)\b/i)
      return simple ? { ruleId: this.ruleId, score: 0.35, span: simple, rationale: 'weak post-hoc causal cue' } : null
    },
  },
  // ─── COGBIAS: cognitive-bias detectors ───────────────────────────────────────────────────────────────
  {
    ruleId: 'COGBIAS.CONFIRM.V1', family: 'COGBIAS',
    run(t) {
      const span = firstMatch(t, /\b(this (just )?(proves|confirms) (what|that) i(’|')?(ve| have) (always )?(said|known|believed)|as (i|we) (always )?(expected|knew|predicted)|obviously (true|right) because)\b/i)
      return span ? { ruleId: this.ruleId, score: 0.55, span, rationale: 'framing evidence only as confirmation of a prior belief' } : null
    },
  },
  {
    ruleId: 'COGBIAS.ANCHOR.V1', family: 'COGBIAS',
    run(t) {
      const span = firstMatch(t, /\b(starting from (the assumption|the fact) that|given that .+ obviously|since (we|it'?s) (already )?established)\b/i)
      return span ? { ruleId: this.ruleId, score: 0.4, span, rationale: 'reasoning anchored on an unquestioned starting premise' } : null
    },
  },
  {
    ruleId: 'COGBIAS.ABSOLUTECERTAINTY.V1', family: 'COGBIAS',
    run(t) {
      // overconfidence cue: certainty words with no hedging anywhere
      const certain = firstMatch(t, /\b(without a doubt|100% certain|absolutely no question|undeniably|it is a fact that|there is no way)\b/i)
      const hedged = /\b(might|maybe|perhaps|possibly|i think|it seems|arguably|likely|could be)\b/i.test(t)
      if (certain && !hedged) return { ruleId: this.ruleId, score: 0.45, span: certain, rationale: 'absolute certainty with no hedging (overconfidence)' }
      return null
    },
  },
  {
    ruleId: 'COGBIAS.AVAILABILITY.V1', family: 'COGBIAS',
    run(t) {
      // vivid recent anecdote generalized to base-rate — "just saw on the news" driving a probability claim
      const span = firstMatch(t, /\b((just )?(saw|heard|read) (it )?on the news|happens all the time (—|-|,)? just look at|there was (just )?(a|this) (case|story) where|my (feed|timeline) is full of)\b/i)
      return span ? { ruleId: this.ruleId, score: 0.4, span, rationale: 'salient recent instance substituted for base rate (availability)' } : null
    },
  },
]

/** Run every detector over a claim's text; return the firings (hits only). Deterministic + order-stable. */
export function runDetectors(text: string): DetectorHit[] {
  const hits: DetectorHit[] = []
  for (const d of DETECTORS) {
    const hit = d.run(text)
    if (hit) hits.push(hit)
  }
  return hits
}

/** The versioned identity of the whole ruleset — the `ruleset_hash` the spec requires for auditability
 *  (§2 Rule ED-1). Any change to a detector's ruleId/family list changes this hash. Content-addressed
 *  over the detector definitions' stable identifiers (not the closures, which don't serialize). */
export function rulesetHash(): string {
  const manifest = DETECTORS.map((d) => `${d.ruleId}:${d.family}`).sort().join('|')
  return 'sha256:' + createHash('sha256').update(manifest).digest('hex').slice(0, 32)
}

export const RULESET_SEMVER = '0.1.0'

/** The detector-family → id list, for callers/tests that want to enumerate coverage. */
export function detectorIds(): string[] {
  return DETECTORS.map((d) => d.ruleId)
}
