/**
 * prime-topics — Moat 3, Pillar A: the prime-topic algebra.
 *
 * Bridges the latent vector space (Moat 1) to the proof fabric (Moat 3) via the
 * identity_is_prime construction: the irreducible basis topics are the *primes*
 * of meaning. Where number theory factors integers into primes, we factor
 * meaning into prime topics.
 *
 *   • each of the 22 TriTRPC basis topics is assigned a prime pᵢ
 *   • a topic mixture is an exponent vector e ∈ ℕ²² (the "prime topic vector")
 *   • composition of meaning is the free commutative monoid: e ⊕ e' = e + e'
 *   • the canonical identity signature is the prime encoding ∏ pᵢ^eᵢ (a BigInt),
 *     which is *uniquely factorable* — two items with the same signature have the
 *     identical topic decomposition
 *   • the empty mixture e = 0 encodes to 1 — the identity element, i.e. the
 *     "23rd topic = the domain itself" pole
 *   • a mod-M congruence lane accumulates evidence with wraparound (for the
 *     learning loop's delta tracking)
 */

/** The 22 TriTRPC basis codes (training_lineage order) ↔ the first 22 primes. */
export const TOPIC_CODES = [
  'rte', 'pol', 'trt', 'rsk', 'asr', 'nov', 'cmp', 'cap', 'prv', 'cau', 'sch',
  'wrd', 'dlg', 'tem', 'cul', 'wfl', 'lrn', 'mem', 'ret', 'pln', 'act', 'inc',
] as const
export type TopicCode = typeof TOPIC_CODES[number]

export const PRIMES = [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53, 59, 61, 67, 71, 73, 79] as const
export const DIMENSION = TOPIC_CODES.length // 22

export const TOPIC_PRIME: Record<string, number> = Object.fromEntries(TOPIC_CODES.map((c, i) => [c, PRIMES[i]!]))

/** Exponent vector (prime topic vector): index i = exponent of topic TOPIC_CODES[i]. */
export type ExponentVector = number[]

export function zeroVector(): ExponentVector { return new Array(DIMENSION).fill(0) }

/** Build an exponent vector from topic codes with integer multiplicities. */
export function exponentVector(weights: Record<string, number>): ExponentVector {
  const e = zeroVector()
  for (const [code, w] of Object.entries(weights)) {
    const idx = TOPIC_CODES.indexOf(code as TopicCode)
    if (idx >= 0 && w > 0) e[idx] = (e[idx] ?? 0) + Math.round(w)
  }
  return e
}

/** Monoid composition of meaning: exponent addition. */
export function compose(a: ExponentVector, b: ExponentVector): ExponentVector {
  return a.map((x, i) => x + (b[i] ?? 0))
}

/** Canonical prime encoding ∏ pᵢ^eᵢ — a uniquely-factorable identity signature.
 *  BigInt, so it never overflows; e = 0 → 1n (the identity / domain pole). */
export function primeEncode(e: ExponentVector): bigint {
  let n = 1n
  for (let i = 0; i < DIMENSION; i++) {
    const exp = e[i] ?? 0
    if (exp > 0) n *= PRIMES[i] !== undefined ? BigInt(PRIMES[i]!) ** BigInt(exp) : 1n
  }
  return n
}

/** Factor a signature back into a prime topic vector (decompose meaning over the
 *  known basis primes — trial division by our 22 primes only, which is the point:
 *  "which irreducible topics compose this meaning?"). Returns null if n has a
 *  factor outside the basis (i.e. it isn't a pure topic signature). */
export function factorize(n: bigint): ExponentVector | null {
  const e = zeroVector()
  let m = n <= 0n ? 1n : n
  for (let i = 0; i < DIMENSION; i++) {
    const p = BigInt(PRIMES[i]!)
    while (m % p === 0n) { e[i]!++; m /= p }
  }
  return m === 1n ? e : null
}

/** A short, stable signature string for atom properties (BigInt → base36). */
export function primeSignature(e: ExponentVector): string { return primeEncode(e).toString(36) }

/** The dominant (highest-exponent) topics — the "prime factors" of the meaning. */
export function dominantTopics(e: ExponentVector, k = 5): { code: TopicCode; exp: number; prime: number }[] {
  return e.map((exp, i) => ({ code: TOPIC_CODES[i]!, exp, prime: PRIMES[i]! }))
    .filter((t) => t.exp > 0).sort((a, b) => b.exp - a.exp).slice(0, k)
}

/** Mod-M congruence lane: accumulate evidence exponents with wraparound. */
export function congruence(e: ExponentVector, M: number): ExponentVector {
  return e.map((x) => ((x % M) + M) % M)
}

/** Cosine-like overlap of two prime topic vectors (shared-meaning measure). */
export function topicOverlap(a: ExponentVector, b: ExponentVector): number {
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < DIMENSION; i++) { const x = a[i] ?? 0, y = b[i] ?? 0; dot += x * y; na += x * x; nb += y * y }
  return na && nb ? dot / Math.sqrt(na * nb) : 0
}
