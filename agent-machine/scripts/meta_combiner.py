#!/usr/bin/env python3
"""
meta_combiner — learn the COUNCIL LAW instead of hand-tuning it. Each arm emits a per-choice vote; we
assemble a feature vector per (question, choice) and learn the optimal combination two ways:
  • SOFTMAX  — multinomial-logistic logits over the signals (the differentiable, learned weighting)
  • SYMBOLIC — gplearn discovers the closed-FORM scoring law (interpretable + deployable as a tool)
Both decide by argmax over a question's four choices, compared to the single arms AND the hand-tuned council.

Why logistic is the RIGHT combiner (not hand-tuned constants): pooling noisy detectors with known
reliabilities is optimally a weighted log-odds sum — exactly what logistic regression fits. Its SIGNED
coefficients do for free what hand-tuning can't: a reliable arm gets a positive weight, an ANTI-predictive
arm gets a NEGATIVE weight (auto-invert), and a lossy arm (e.g. a value-destroying 50:50) gets ~0 (ignored).

The learned weights are EXPORTED to lib/council-weights.json so the live council (lib/council.ts,
learnedCouncilVote) deploys the same law the bench measured — no parallel stack.

Run:  python3 scripts/meta_combiner.py [transcript.jsonl]
  META_ARMS   comma list of arm columns to combine (default: the 8 base arms; champion EXCLUDED — circular)
  META_OUT    weights path (default lib/council-weights.json)
"""
import json, os, sys
import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import GroupShuffleSplit

PATH = sys.argv[1] if len(sys.argv) > 1 else '/tmp/meta/transcript.jsonl'
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.environ.get('META_OUT', os.path.join(HERE, 'lib', 'council-weights.ts'))  # importable module (CJS-safe)
LETTERS = 'ABCD'
# the base arms to combine — exclude 'champion' (it's a combiner itself → leakage) and 'learned' (this).
ARMS = [a.strip() for a in os.environ.get('META_ARMS', 'baseline,brain,qgen,gate,medprompt,elim,fiftyfifty,compute').split(',') if a.strip()]
rows = [json.loads(l) for l in open(PATH) if l.strip()]
if not rows:
    sys.exit(f'no rows in {PATH}')

# keep only arms actually present in the transcript (a given board run may not have run all of them)
present = [a for a in ARMS if any(isinstance(r.get(f'{a}_pred'), str) and r.get(f'{a}_pred') not in ('', '?') for r in rows)]
RETR = [a for a in ('brain', 'qgen') if a in present]     # grounding applies to the retrieval arms

# CONDITIONERS — the logit no longer weights an arm GLOBALLY (which averages brain's +14 on math and −10 on
# abstract algebra to ≈0). Each arm's weight is conditioned on the question:
#   DOMAIN  arm×subject  — captures the per-subject heterogeneity directly
#   KTYPE   arm×{compute,retrieve} — TRANSFERABLE (a computational Q gets computational treatment in ANY
#                                     subject → generalizes to MMLU-Pro's new categories)
#   GROUND  conf×retrieval-vote — trust retrieval more when it's well-grounded (top cosine)
COND_DOMAIN = os.environ.get('COND_DOMAIN', '1') == '1'
COND_KT = os.environ.get('COND_KTYPE', '1') == '1'
COND_GR = os.environ.get('COND_GROUND', '1') == '1'
domains = sorted({r.get('subject', '?') for r in rows if r.get('subject')}) if COND_DOMAIN else []


def kt_flags(r):
    s = ' '.join(r.get('ktype') or []) if isinstance(r.get('ktype'), list) else str(r.get('ktype') or '')
    return (int('omput' in s or 'hain' in s), int('etriev' in s or 'BasicFact' in s or 'Definition' in s))


# FEATS name list + featvec() extractor, built in LOCKSTEP so training and the exported weights agree.
FEATS = list(present)
for a in present:
    FEATS += [f'{a}@{d}' for d in domains]
if COND_KT:
    for a in present:
        FEATS += [f'{a}*kt_compute', f'{a}*kt_retrieve']
if COND_GR:
    FEATS += [f'{a}*ground' for a in RETR]
FEATS.append('isA')


def featvec(r, L, ci):
    sub = r.get('subject', '?'); ktc, ktr = kt_flags(r)
    conf = {'brain': float(r.get('brain_conf') or 0.0), 'qgen': float(r.get('qgen_conf') or 0.0)}
    vote = {a: int(r.get(f'{a}_pred') == L) for a in present}
    x = [vote[a] for a in present]
    for a in present:
        x += [vote[a] * int(sub == d) for d in domains]
    if COND_KT:
        for a in present:
            x += [vote[a] * ktc, vote[a] * ktr]
    if COND_GR:
        x += [vote[a] * conf.get(a, 0.0) for a in RETR]
    x.append(int(ci == 0))
    return x


print(f"# meta_combiner · {len(rows)} questions · arms=[{', '.join(present)}] · {len(FEATS)} feats "
      f"(domain={'on' if domains else 'off'} ktype={'on' if COND_KT else 'off'} ground={'on' if COND_GR else 'off'})\n")
X, y, g = [], [], []
for qi, r in enumerate(rows):
    gold = r.get('gold')
    if not gold:
        continue
    for ci, L in enumerate(LETTERS):
        X.append(featvec(r, L, ci)); y.append(int(L == gold)); g.append(qi)
X = np.array(X, float); y = np.array(y); g = np.array(g)

gss = GroupShuffleSplit(n_splits=1, test_size=0.35, random_state=1729)
tr, te = next(gss.split(X, y, g))
tg = g[te]


def qacc(score):                                # per-question argmax over the 4 choices (the deployed decision)
    corr = nq = 0
    for q in np.unique(tg):
        m = np.where(tg == q)[0]; pick = m[int(np.argmax(score[m]))]
        corr += y[te][pick]; nq += 1
    return corr / nq if nq else 0.0


# single arms — each arm's OWN accuracy (argmax of its one-hot, tiny jitter to break the all-zero ties)
jit = 1e-6 * np.random.RandomState(0).rand(len(te))
for j, nm in enumerate(present):
    print(f"  arm  {nm:11}: {qacc(X[te][:, j] + jit):.1%}")

# SOFTMAX (logistic) combiner — the learned law
lr = LogisticRegression(max_iter=2000, class_weight='balanced').fit(X[tr], y[tr])
softmax_acc = qacc(lr.predict_proba(X[te])[:, 1])
weights = {f: float(w) for f, w in zip(FEATS, lr.coef_[0])}
print(f"\n  SOFTMAX combiner : {softmax_acc:.1%}   (learned, signed — auto-inverts anti-predictive arms)")
print('    learned weights: ' + '  '.join(f'{f}={w:+.2f}' for f, w in weights.items()))
neg = [f for f, w in weights.items() if w < -0.05 and f != 'isA']
if neg:
    print(f'    ↳ AUTO-INVERTED (negative weight = the arm is reliably wrong, used backwards): {", ".join(neg)}')

# SYMBOLIC-REGRESSION combiner — the interpretable closed-form law (the tzurah)
sym = None
try:
    from gplearn.genetic import SymbolicRegressor
    sr = SymbolicRegressor(population_size=3000, generations=25,
                           function_set=('add', 'sub', 'mul', 'max', 'min'), feature_names=FEATS,
                           parsimony_coefficient=0.02, random_state=1729, verbose=0, n_jobs=-1)
    sr.fit(X[tr], y[tr])
    sym = str(sr._program)
    print(f"\n  SYMBOLIC combiner: {qacc(sr.predict(X[te])):.1%}")
    print(f"    discovered LAW: {sym}")
except Exception as e:
    print(f"\n  [symbolic regression unavailable: {e}]")

# report where domain-conditioning actually moved an arm (the +14/−10 the global weight was hiding)
if domains:
    for a in ('brain', 'qgen'):
        if a not in present:
            continue
        ds = sorted(((d, weights.get(f'{a}@{d}', 0.0)) for d in domains), key=lambda x: x[1])
        if ds:
            print(f"    {a} by domain: " + '  '.join(f'{d.split("_")[-1]}={weights.get(a,0)+w:+.2f}' for d, w in ds[:2] + ds[-2:]))

# EXPORT — STRUCTURED so learnedCouncilVote can apply the per-question weight:
#   weight(arm | domain, ktype, conf) = w[arm] + domain[arm][d] + kt[arm].{compute|retrieve} + ground[arm]*conf
r4 = lambda v: round(float(v), 4)
payload = {
    'version': '2', 'arms': present, 'domains': domains,
    'w': {a: r4(weights.get(a, 0.0)) for a in present},
    'domain': {a: {d: r4(weights.get(f'{a}@{d}', 0.0)) for d in domains} for a in present} if domains else {},
    'kt': {a: {'compute': r4(weights.get(f'{a}*kt_compute', 0.0)), 'retrieve': r4(weights.get(f'{a}*kt_retrieve', 0.0))} for a in present} if COND_KT else {},
    'ground': {a: r4(weights.get(f'{a}*ground', 0.0)) for a in RETR} if COND_GR else {},
    'isA': r4(weights.get('isA', 0.0)),
    'softmax_test_acc': round(softmax_acc, 4), 'symbolic_law': sym,
    'trained_on': os.path.basename(PATH), 'n_questions': int(len(np.unique(g))),
}
os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, 'w') as f:
    f.write('// AUTO-GENERATED by scripts/meta_combiner.py — do not edit by hand.\n')
    f.write(f'// trained on {payload["trained_on"]} (n={payload["n_questions"]}), softmax test acc {softmax_acc:.1%}.\n')
    f.write('// The signed weights ARE the council, learned from evidence — deployed via learnedCouncilVote (lib/council.ts).\n')
    f.write('export const COUNCIL_WEIGHTS = ' + json.dumps(payload, indent=2) + ' as const\n')
print(f"\n# EXPORTED learned council → {OUT}  (statically imported by lib/council.ts)")
print("# retrain on each CLEAN board transcript as arms/data accumulate; the bench measures the deployed law.")
