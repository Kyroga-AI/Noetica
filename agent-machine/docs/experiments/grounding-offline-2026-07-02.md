# Grounding / retrieval — offline analysis of the frontier0630 board (2026-07-02)

**Question:** the `ground` arm sits *below* baseline (59.8 vs 62.7 on frontier0630). Is there a cheap
gate/routing fix that makes grounding a net-positive production contributor? Analysed **offline against the
real per-question board transcripts** (`gs://sourceos-artifacts-socioprophet/ocw-corpus/bench/ckpt-*.jsonl`)
— zero GPU spend. Reproduce: `scripts/grounding-gate-offline.py`, `scripts/grounding-marginal.py`.

## Single-arm accuracy (n=450, qwen2.5:7b, frontier0630)
| baseline | ground | prod (ships) | opcompute | reason |
|---|---|---|---|---|
| 62.7 | **59.8** | **72.4** | 70.7 | 72.0 |

## What was tested, and the verdicts

1. **CRAG confidence gate** (closed-book self-consistency `gate_agree` ≥ t → skip retrieval, else `ground`):
   best threshold gives **61.6% — still below the 62.7 baseline.** The earlier n=30 win (63.3 vs 55 in
   `crag-gate.ts`) does NOT reproduce at n=450 against strong arms. **Dead end.**
2. **canon_grounding trigger** (retrieve on `partial`/`ungrounded`, trust closed-book on `grounded`):
   ground *loses* on both partial (−2.8) and ungrounded (−3.2). The signal is not discriminative — matches
   the lesson already in `lib/grounding-signal.ts` (candidateNPs flags an out-of-canon NP on ~every question).
   **Dead end.**
3. **Strong-arm majority vote** (prod+opcompute+reason): 73.3% vs prod 72.4 — but **McNemar p=0.45, NOT
   significant** (b=10, c=6). Noise. Including the weak arms (ground/baseline) *drops* the vote to 69.8.
   **Not a real win.**

## What IS true: grounding's value is decorrelated complementarity, not standalone accuracy
- `ground` **uniquely solves 9 questions** (more than any other arm: baseline 7, prod 6, reason 6, opcompute 4).
- `ground` rescues **30 Qs that opcompute misses**; `ground ∪ opcompute` = **77.3%** vs opcompute 70.7 (**+6.6pp**).
- Oracle over {baseline,ground,prod,opcompute,reason} = **84.0%** vs prod 72.4 → real headroom, BUT it requires
  predicting ground's unique-solve slice, and **no available signal (gate_agree, canon_grounding, subject)
  predicts it.** So the headroom is currently unrealizable.

## Conclusion / decision
- **Grounding is a ~1pp MCQ knob at best; the moat stays verified-compute (prod/opcompute/reason ≈ 72).**
- **Demote always-on `ground` from the production/vote path** (net negative; keep as a bench + candidate
  ensemble arm per "keep all arms, promote only winners").
- The genuine lever is **retrieval QUALITY, not gating** — `ground` flips **25 correct answers to wrong**.
  A better/decorrelated retriever (kgbert, HippoRAG dual-layer, RAPTOR) that stops those flips would raise
  ground's floor and make it ensemble-safe.
- **Discipline:** do NOT spend GPU chasing the 84% oracle until a candidate feature demonstrably predicts the
  ground-unique slice *offline* on these transcripts first.
