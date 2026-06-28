#!/usr/bin/env python3
"""
board-compare — read board transcript(s) and report per-arm accuracy with CONFIDENCE INTERVALS, and (given
two boards on the same seed/questions) the PAIRED delta per arm with a significance test. Stops us over-reading
small-n deltas: an n=100 swing of a few points is often noise, and the whole IFTTT fork (does dedup+equations
help?) hinges on reading the brain-arm delta correctly.

  • single board  → per-arm accuracy + Wilson 95% CI (the honest error bar on a proportion)
  • two boards    → per-arm McNemar test on the matched questions: the discordant pairs (A-right/B-wrong vs
                    A-wrong/B-right) are what a *paired* comparison actually rests on; exact two-sided binomial p.

The transcript is the board's per-question dump (~/.noetica/mmlu-brain-*.jsonl, uploaded to bench/transcript-*):
rows of {subject, i, gold, <arm>_pred, ...}. Arms auto-detected.

Run:  python3 scripts/board-compare.py dedup.jsonl [v4.jsonl]   [--labels dedup,v4]
"""
import json, sys, math
from collections import defaultdict

args = [a for a in sys.argv[1:] if not a.startswith('--')]
labels = next((a.split('=', 1)[1] for a in sys.argv if a.startswith('--labels=')), None)
if not args:
    sys.exit('usage: board-compare.py boardA.jsonl [boardB.jsonl] [--labels A,B]')
LA, LB = (labels.split(',') + ['A', 'B'])[:2] if labels else ('A', 'B')
Z = 1.959963985            # 95%


def load(path):
    """→ {(subject,i): {gold, arm: pred}} keyed per question; arms seen."""
    qs, arms = {}, set()
    for ln in open(path):
        ln = ln.strip()
        if not ln:
            continue
        try:
            r = json.loads(ln)
        except Exception:
            continue
        gold = r.get('gold')
        if not gold:
            continue
        key = (r.get('subject', '?'), r.get('i', len(qs)))
        preds = {}
        for k, v in r.items():
            if k.endswith('_pred') and isinstance(v, str):
                a = k[:-5]
                preds[a] = v
                arms.add(a)
        qs[key] = {'gold': gold, 'preds': preds}
    return qs, arms


def wilson(c, n):
    if n == 0:
        return (0.0, 0.0, 0.0)
    p = c / n
    d = 1 + Z * Z / n
    center = (p + Z * Z / (2 * n)) / d
    half = (Z / d) * math.sqrt(p * (1 - p) / n + Z * Z / (4 * n * n))
    return (100 * p, 100 * max(0, center - half), 100 * min(1, center + half))


def mcnemar_p(b, c):
    """exact two-sided binomial p for the discordant pairs (b vs c) under H0 p=0.5."""
    n = b + c
    if n == 0:
        return 1.0
    k = min(b, c)
    tail = sum(math.comb(n, i) for i in range(0, k + 1)) / (2 ** n)
    return min(1.0, 2 * tail)


def acc(qs, arm):
    c = sum(1 for q in qs.values() if q['preds'].get(arm) == q['gold'])
    n = sum(1 for q in qs.values() if arm in q['preds'])
    return c, n


def main():
    A, armsA = load(args[0])
    print(f"# {LA}: {len(A)} questions · arms {sorted(armsA)}\n")
    if len(args) == 1:
        print(f"  {'arm':12}{'acc':>8}   {'95% CI (Wilson)':>18}   n")
        for arm in sorted(armsA):
            c, n = acc(A, arm)
            p, lo, hi = wilson(c, n)
            print(f"  {arm:12}{p:7.1f}%   [{lo:5.1f}, {hi:5.1f}]   {n}")
        return
    B, armsB = load(args[1])
    common = set(A) & set(B)
    print(f"# {LB}: {len(B)} questions · matched to {LA} on {len(common)} questions\n")
    print(f"  {'arm':12}{LA+' acc':>11}{LB+' acc':>11}{'Δ(B−A)':>9}{'disc b/c':>10}{'p':>8}  signif")
    for arm in sorted(armsA & armsB):
        ca, na = acc({k: A[k] for k in common}, arm)
        cb, nb = acc({k: B[k] for k in common}, arm)
        # paired discordance on the matched questions
        b = sum(1 for k in common if A[k]['preds'].get(arm) == A[k]['gold'] and B[k]['preds'].get(arm) != B[k]['gold'])
        c = sum(1 for k in common if A[k]['preds'].get(arm) != A[k]['gold'] and B[k]['preds'].get(arm) == B[k]['gold'])
        pa = 100 * ca / na if na else 0
        pb = 100 * cb / nb if nb else 0
        p = mcnemar_p(b, c)
        sig = '***' if p < 0.01 else '**' if p < 0.05 else '*' if p < 0.1 else 'ns'
        print(f"  {arm:12}{pa:10.1f}%{pb:10.1f}%{pb-pa:+8.1f}{f'{b}/{c}':>10}{p:8.3f}  {sig}")
    print(f"\n# Δ = {LB} − {LA} on the {len(common)} shared questions. b/c = discordant pairs "
          f"({LA}-right/{LB}-wrong  vs  {LA}-wrong/{LB}-right). p = exact two-sided McNemar. *** p<.01 ** p<.05 * p<.1 ns=noise.")
    print("# the brain-arm row is the IFTTT readout: is the difference real or within the error bar?")


if __name__ == '__main__':
    main()
