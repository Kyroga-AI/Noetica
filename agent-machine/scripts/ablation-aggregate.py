#!/usr/bin/env python3
"""ablation-aggregate — read the per-(technique,seed) board checkpoints and LOCK IN the result:
for every technique, its accuracy mean±std across seeds, its delta vs baseline (overall AND per subject),
and a combine/neutral/do-not verdict. Writes canon/ablation-results.json (the durable matrix) and prints
the locked-in table. The delta is measured WITHIN each run (technique vs baseline on the same sample), then
averaged across seeds — so the sample variance cancels and what remains is the technique's own effect.

PIT note: re-run after any brain/enrichment change — these numbers are point-in-time to the brain version.
"""
import sys, json, glob, os, re
import statistics as st
from collections import defaultdict

OUT = sys.argv[1] if len(sys.argv) > 1 else 'canon/ablation-results'
runs = defaultdict(list)                                   # technique -> [(seed, rows), ...]
for f in sorted(glob.glob(os.path.join(OUT, '*.jsonl'))):
    m = re.match(r'(.+)__seed(\d+)\.jsonl', os.path.basename(f))
    if not m:
        continue
    rows = [json.loads(l) for l in open(f) if l.strip()]
    if rows:
        runs[m.group(1)].append((m.group(2), rows))

def acc(rows, arm, subject=None):
    sel = [r for r in rows if (subject is None or r.get('subject') == subject) and isinstance(r.get(f'{arm}_pred'), str)]
    ok = [1 if r.get(f'{arm}_ok') else 0 for r in sel]
    return 100 * sum(ok) / len(ok) if ok else None

subjects = sorted({r['subject'] for sr in runs.values() for _, rows in sr for r in rows if r.get('subject')})
result = {}
for tech, seedruns in runs.items():
    arm = 'baseline' if tech == 'base' else tech
    tA, bA = [], []
    subj_delta = defaultdict(list)
    for _seed, rows in seedruns:
        ta, ba = acc(rows, arm), acc(rows, 'baseline')
        if ta is not None and ba is not None:
            tA.append(ta); bA.append(ba)
        for s in subjects:
            ts, bs = acc(rows, arm, s), acc(rows, 'baseline', s)
            if ts is not None and bs is not None:
                subj_delta[s].append(ts - bs)
    if not tA:
        continue
    result[tech] = {
        'arm': arm, 'n_seeds': len(tA),
        'acc_mean': round(st.mean(tA), 1), 'acc_std': round(st.pstdev(tA), 1) if len(tA) > 1 else 0.0,
        'base_mean': round(st.mean(bA), 1),
        'delta': round(st.mean(tA) - st.mean(bA), 1),
        'delta_std': round(st.pstdev([t - b for t, b in zip(tA, bA)]), 1) if len(tA) > 1 else 0.0,
        'subject_delta': {s: round(st.mean(v), 1) for s, v in subj_delta.items() if v},
    }

os.makedirs('canon', exist_ok=True)
json.dump(result, open('canon/ablation-results.json', 'w'), indent=1)

print(f"\n{'='*78}\nLOCKED-IN ABLATION MATRIX  (each technique on base=baseline,brain · n seeds)\n{'='*78}")
print(f"{'technique':12}{'acc±std':>12}{'base':>7}{'Δ±std':>10}  verdict   best/worst subject")
for tech in sorted(result, key=lambda t: -(result[t]['delta'])):
    r = result[tech]
    d = r['delta']
    v = 'COMBINE ' if d >= 1 else ('neutral ' if abs(d) < 1 else 'DO-NOT  ')
    sd = r['subject_delta']
    hi = max(sd, key=sd.get) if sd else '-'; lo = min(sd, key=sd.get) if sd else '-'
    best = f"+{sd[hi]}@{hi.split('_')[-1][:9]}" if sd else ''
    worst = f"{sd[lo]}@{lo.split('_')[-1][:9]}" if sd else ''
    print(f"{tech:12}{(str(r['acc_mean'])+'±'+str(r['acc_std'])):>12}{r['base_mean']:>7}"
          f"{(('+' if d >= 0 else '')+str(d)+'±'+str(r['delta_std'])):>10}  {v}  {best:18} {worst}")
print(f"\nlocked → canon/ablation-results.json  ({len(result)} techniques, {len(subjects)} subjects)")
