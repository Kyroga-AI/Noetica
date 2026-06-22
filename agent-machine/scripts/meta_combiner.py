#!/usr/bin/env python3
"""
meta_combiner — learn the COUNCIL LAW instead of hand-tuning it. Each arm/tool emits a per-choice
signal; we assemble a feature vector per (question, choice) and learn the combination two ways:
  • SOFTMAX  — multinomial-logistic logits over the signals (the differentiable, learned weighting)
  • SYMBOLIC — gplearn discovers the closed-FORM scoring law (interpretable + deployable as a tool)
Both decide by argmax over a question's four choices. Compared to the single arms + the hand-tuned
council. The discovered symbolic law is the reusable artifact — the form (tzurah) of how to weigh
evidence, extracted from the signals (chomer).

Run:  python3 scripts/meta_combiner.py [transcript.jsonl]
"""
import json, sys
import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import GroupShuffleSplit

PATH = sys.argv[1] if len(sys.argv) > 1 else '/tmp/meta/transcript.jsonl'
LETTERS = 'ABCD'
rows = [json.loads(l) for l in open(PATH) if l.strip()]


def kt_flags(kt):
    s = ' '.join(kt) if isinstance(kt, list) else str(kt or '')
    return [int('omput' in s or 'hain' in s), int('etriev' in s or 'BasicFact' in s or 'Definition' in s)]


FEATS = ['base', 'brain', 'elim', 'agree', 'cover', 'isA', 'kt_compute', 'kt_retrieve']
X, y, g = [], [], []
for qi, r in enumerate(rows):
    gold = r.get('gold')
    n = max(len(r.get('qgen', []) or []), 4)
    for ci, L in enumerate(LETTERS):
        X.append([
            int(r.get('baseline_pred') == L), int(r.get('brain_pred') == L), int(r.get('elim_pred') == L),
            float(r.get('sc_agree') or 0.0), float(r.get('coverage') or 0.0), int(ci == 0),
        ] + kt_flags(r.get('ktype')))
        y.append(int(L == gold)); g.append(qi)
X = np.array(X, float); y = np.array(y); g = np.array(g)

gss = GroupShuffleSplit(n_splits=1, test_size=0.35, random_state=1729)
tr, te = next(gss.split(X, y, g))
tg = g[te]


def qacc(score):                       # per-question argmax over the 4 choices
    corr = nq = 0
    for q in np.unique(tg):
        m = np.where(tg == q)[0]; pick = m[int(np.argmax(score[m]))]
        corr += y[te][pick]; nq += 1
    return corr / nq


print(f"# meta_combiner · {len(rows)} questions · {len(np.unique(g))} groups · test={len(np.unique(tg))} q\n")
# single arms (argmax of the arm's own one-hot pick)
for j, nm in [(0, 'baseline'), (1, 'brain'), (2, 'elim')]:
    print(f"  arm  {nm:9}: {qacc(X[te][:, j] + 1e-6 * np.random.RandomState(0).rand(len(te))):.1%}")

# SOFTMAX (logistic) combiner
lr = LogisticRegression(max_iter=2000, class_weight='balanced').fit(X[tr], y[tr])
print(f"\n  SOFTMAX  combiner: {qacc(lr.predict_proba(X[te])[:, 1]):.1%}")
print('    learned weights: ' + '  '.join(f'{f}={w:+.2f}' for f, w in zip(FEATS, lr.coef_[0])))

# SYMBOLIC-REGRESSION combiner — discover the closed-form law
try:
    from gplearn.genetic import SymbolicRegressor
    sr = SymbolicRegressor(population_size=3000, generations=25,
                           function_set=('add', 'sub', 'mul', 'max', 'min'), feature_names=FEATS,
                           parsimony_coefficient=0.02, random_state=1729, verbose=0, n_jobs=-1)
    sr.fit(X[tr], y[tr])
    print(f"\n  SYMBOLIC combiner: {qacc(sr.predict(X[te])):.1%}")
    print(f"    discovered LAW: {sr._program}")
except Exception as e:
    print(f"\n  [symbolic regression unavailable: {e}]")

print("\n# the softmax weights / symbolic law ARE the council — learned from evidence, not hand-tuned.")
print("# next: emit as a reasoning-evidence tool; retrain as transcripts accumulate (more arms, n=30x7).")
