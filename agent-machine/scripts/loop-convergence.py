#!/usr/bin/env python3
"""loop-convergence — the STOPPING CRITERION for the self-improving loop. Each round appends its result
(accuracy, residual recoverable-q, substrate sizes, wall-hours, technique-set, manifest hash). This reads
the round history and answers: is the learning SATURATED? It fits a saturating curve (acc → asymptote),
reports the MARGINAL gain per round AND per hour, and emits STOP when the margin drops below ε for k rounds
— i.e. diminishing returns. Saturation is PER TECHNIQUE-SET: when a round CHANGES the technique-set, the
curve is allowed a new asymptote (adding a decorrelated arm resets the ceiling). Lineage: neural scaling
laws (power-law diminishing returns) + AdaBoost stopping (weak learner can't beat the residual).

  record:  python3 scripts/loop-convergence.py record acc=60.7 recoverable_q=40 ops=63 symbols=1033 hours=2.0 techset=base+rag
  status:  python3 scripts/loop-convergence.py status
"""
import sys, os, json, time
import numpy as np
LOG = os.path.join(os.path.dirname(__file__), '..', 'canon', 'loop-rounds.jsonl')
EPS_ROUND = float(os.environ.get('LOOP_EPS_ROUND', '0.5'))   # stop when <0.5 pts/round
EPS_HOUR  = float(os.environ.get('LOOP_EPS_HOUR', '0.3'))    # …or <0.3 pts/hour (value-of-time)
PATIENCE  = int(os.environ.get('LOOP_PATIENCE', '2'))         # for this many consecutive rounds

def record(kv):
    row = {'ts': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}
    for a in kv:
        k, v = a.split('=', 1)
        row[k] = float(v) if v.replace('.', '').replace('-', '').isdigit() else v
    rounds = load(); row['round'] = len(rounds)
    with open(LOG, 'a') as f: f.write(json.dumps(row) + '\n')
    print(f"recorded round {row['round']}: {row}")

def load():
    if not os.path.exists(LOG): return []
    return [json.loads(l) for l in open(LOG) if l.strip()]

def fit_asymptote(r, acc):
    """acc(r) = L - (L-a0)·exp(-k·r); estimate the reachable ceiling L and decay k. Falls back gracefully."""
    if len(r) < 3:
        return None, None
    try:
        from scipy.optimize import curve_fit
        f = lambda x, L, a0, k: L - (L - a0) * np.exp(-k * x)
        p, _ = curve_fit(f, r, acc, p0=[max(acc) + 5, acc[0], 0.5], maxfev=8000,
                         bounds=([max(acc), 0, 0.01], [100, 100, 5]))
        return float(p[0]), float(p[2])
    except Exception:
        return None, None

def status():
    rounds = load()
    if not rounds:
        print("no rounds yet — record round 0 first."); return
    acc = [r.get('acc', 0) for r in rounds]
    hrs = [r.get('hours', 1) for r in rounds]
    ts  = [r.get('techset', '?') for r in rounds]
    print(f"{'rnd':>3}{'acc':>7}{'Δ/rnd':>8}{'Δ/hr':>8}{'recov':>7}{'ops':>6}{'sym':>7}  techset")
    sat_streak = 0
    for i, r in enumerate(rounds):
        d = acc[i] - acc[i-1] if i else 0.0
        dh = d / hrs[i] if i and hrs[i] else 0.0
        reset = ' ←NEW techset (ceiling reset)' if i and ts[i] != ts[i-1] else ''
        flat = (i > 0 and abs(d) < EPS_ROUND and abs(dh) < EPS_HOUR and not reset)
        sat_streak = sat_streak + 1 if flat else 0
        print(f"{i:>3}{acc[i]:>7.1f}{(('+' if d>=0 else '')+f'{d:.1f}') if i else '—':>8}"
              f"{(f'{dh:.2f}') if i else '—':>8}{int(r.get('recoverable_q',0)):>7}{int(r.get('ops',0)):>6}{int(r.get('symbols',0)):>7}  {ts[i]}{reset}")
    L, k = fit_asymptote(list(range(len(acc))), acc)
    print()
    if L:
        captured = 100 * (acc[-1] - acc[0]) / max(L - acc[0], 1e-9)
        next_gain = (L - acc[-1]) * (1 - np.exp(-k))   # projected gain of the next round
        print(f"  fitted reachable ceiling (this techset): {L:.1f}%   ·   captured {captured:.0f}% of it")
        print(f"  projected next-round gain: {next_gain:+.2f} pts   (decay k={k:.2f})")
    verdict = ("SATURATED → STOP enriching; ADD A NEW TECHNIQUE to reset the ceiling"
               if sat_streak >= PATIENCE else
               f"CONTINUE — margin still above ε (need {PATIENCE-sat_streak} more flat round(s) to stop)")
    print(f"  marginal-return verdict: {verdict}")

if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == 'record': record(sys.argv[2:])
    else: status()
