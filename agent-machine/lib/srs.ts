/**
 * srs.ts — spaced-repetition scheduling (SM-2) over the user's own knowledge. The #1 PKM retention complaint
 * is "notes go in, nothing comes back out"; SRS turns graph nodes / facts into review cards. Fully offline,
 * deterministic — no model needed for scheduling. now is injected for determinism.
 */
export interface Card { ease: number; intervalDays: number; reps: number; due: number }   // due = epoch ms
const DAY = 86_400_000

export function newCard(now: number): Card {
  return { ease: 2.5, intervalDays: 0, reps: 0, due: now }
}

/** Grade: 0=again, 1=hard, 2=good, 3=easy. SM-2 update of ease/interval/due. */
export function review(card: Card, grade: 0 | 1 | 2 | 3, now: number): Card {
  let { ease, intervalDays, reps } = card
  if (grade === 0) {
    reps = 0; intervalDays = 0                       // lapse → relearn
  } else {
    reps += 1
    intervalDays = reps === 1 ? 1 : reps === 2 ? 6 : Math.round(intervalDays * ease)
  }
  // SM-2 ease adjustment (q mapped: again=2, hard=3, good=4, easy=5)
  const q = grade + 2
  ease = Math.max(1.3, ease + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)))
  return { ease: Number(ease.toFixed(3)), intervalDays, reps, due: now + intervalDays * DAY }
}

export function dueCards<T extends { card: Card }>(items: T[], now: number): T[] {
  return items.filter((i) => i.card.due <= now).sort((a, b) => a.card.due - b.card.due)
}
