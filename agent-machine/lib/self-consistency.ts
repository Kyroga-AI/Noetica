/**
 * self-consistency.ts — sample-and-vote over CoT answers (Wang et al. 2022). The fallback selector when a
 * claim isn't verifier-checkable: cluster N sampled answers by meaning, return the majority. Complements
 * best-of-N (which dominates when the verifier applies).
 */
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ').replace(/[.!?]+$/, '')

/** Majority vote with an injectable equivalence predicate (defaults to normalized exact match). */
export function majorityVote(answers: string[], equiv: (a: string, b: string) => boolean = (a, b) => norm(a) === norm(b)): { answer: string | null; votes: number; fraction: number; clusters: number } {
  if (answers.length === 0) return { answer: null, votes: 0, fraction: 0, clusters: 0 }
  const groups: Array<{ rep: string; members: string[] }> = []
  for (const a of answers) {
    const g = groups.find((gr) => equiv(gr.rep, a))
    if (g) g.members.push(a)
    else groups.push({ rep: a, members: [a] })
  }
  groups.sort((x, y) => y.members.length - x.members.length)
  const top = groups[0]!
  return { answer: top.rep, votes: top.members.length, fraction: top.members.length / answers.length, clusters: groups.length }
}
