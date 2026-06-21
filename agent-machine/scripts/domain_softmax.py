#!/usr/bin/env python3
"""
domain_softmax — the classifier that replaces the failing LLM "which domain?" step.

Each domain is an ANCHOR in the corpus's topic space (LSI / the bridge space). A new problem
is embedded into that space and a SOFTMAX over the anchors picks its domain — and the softmax
probability IS the confidence (low max-prob → abstain). This is the vector basis doing its
honest job: not retrieving an answer (a wash), but LOCATING the problem among the domains.

Tested directly on the MMLU sets: route each question to a STEM department anchor and check it
lands in the expected one. If it routes physics→8, math→18, chem→5… the classifier works, and
it's the front end the verified-compute engine has been missing.

Run:  python3 scripts/domain_softmax.py [--k 22]
"""
import os, sys, json, glob
import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer, ENGLISH_STOP_WORDS
from sklearn.decomposition import TruncatedSVD
from derive_topics import course_doc, dept, CORPUS, STOP
from reconcile_topics import SPOKEN

K = int(next((sys.argv[i + 1] for i, a in enumerate(sys.argv) if a == '--k'), 22))
DEPT_NAME = {'18': 'mathematics', '8': 'physics', '5': 'chemistry', '7': 'biology',
             '6': 'eecs', '12': 'earth', '20': 'bio-eng', '2': 'mech', '22': 'nuclear'}
# each MMLU subject → the set of acceptable domain anchors (astronomy is physics OR earth)
SUBJECT_ACCEPT = {
    'college_mathematics': {'18'}, 'abstract_algebra': {'18'}, 'high_school_mathematics': {'18'},
    'high_school_statistics': {'18'}, 'college_physics': {'8'}, 'conceptual_physics': {'8'},
    'high_school_physics': {'8'}, 'astronomy': {'8', '12'}, 'college_chemistry': {'5'},
    'high_school_chemistry': {'5'}, 'college_biology': {'7'}, 'high_school_biology': {'7'},
    'college_computer_science': {'6'}, 'electrical_engineering': {'6'},
}
ANCHOR_DEPTS = ['18', '8', '5', '7', '6', '12']   # + earth, so astronomy has a home


def main():
    docs, depts = [], []
    for d in sorted(glob.glob(CORPUS + '/*/')):
        slug, doc = course_doc(d)
        if len(doc) > 200:
            docs.append(doc); depts.append(dept(slug))
    depts = np.array(depts)

    stop = list(ENGLISH_STOP_WORDS | STOP | SPOKEN)
    tfv = TfidfVectorizer(stop_words=stop, token_pattern=r'[A-Za-z][A-Za-z]{3,}',
                          min_df=8, max_df=0.3, max_features=15000)
    Xc = tfv.fit_transform(docs)
    bank = json.load(open(os.path.expanduser('~/.noetica/corpus/benchmarks/mmlu_stem.json')))
    samples = {s: [x['question'] for x in bank.get(s, [])][:40] for s in SUBJECT_ACCEPT}
    Qtf = {s: tfv.transform(qs) for s, qs in samples.items()}

    def evaluate(Kdim):
        lsi = TruncatedSVD(Kdim, random_state=0)
        Dc = lsi.fit_transform(Xc); Dc /= (np.linalg.norm(Dc, axis=1, keepdims=True) + 1e-9)
        A = np.array([(lambda a: a / (np.linalg.norm(a) + 1e-9))(Dc[depts == dp].mean(0)) for dp in ANCHOR_DEPTS])
        out = {}
        for s, qtf in Qtf.items():
            q = lsi.transform(qtf); q /= (np.linalg.norm(q, axis=1, keepdims=True) + 1e-9)
            e = np.exp((q @ A.T) * 8.0); p = e / e.sum(1, keepdims=True)
            routed = [ANCHOR_DEPTS[i] for i in p.argmax(1)]
            c = sum(1 for r in routed if r in SUBJECT_ACCEPT[s])
            out[s] = (c, len(routed), p.max(1).mean())
        return out

    print(f"# domain softmax — route MMLU question → domain anchor · {len(docs)} courses")
    print(f"  anchors ({len(ANCHOR_DEPTS)}): {', '.join(f'{d}={DEPT_NAME[d]}' for d in ANCHOR_DEPTS)}")
    print(f"  random baseline ≈ {100//len(ANCHOR_DEPTS)}%\n")
    print(f"  {'resolution K':>12}   overall   astronomy   HS-stats")
    print(f"  {'─'*12}   {'─'*7}   {'─'*9}   {'─'*8}")
    best = (0, None)
    for Kdim in (22, 60, 120, 200):
        r = evaluate(Kdim)
        tc = sum(v[0] for v in r.values()); tn = sum(v[1] for v in r.values())
        acc = 100 * tc / tn
        ast = 100 * r['astronomy'][0] // r['astronomy'][1]
        sta = 100 * r['high_school_statistics'][0] // r['high_school_statistics'][1]
        mark = ' ←best' if acc > best[0] else ''
        if acc > best[0]: best = (acc, Kdim)
        print(f"  {Kdim:>12}   {acc:>5.0f}%    {ast:>6}%      {sta:>5}%{mark}")
    print(f"\n  best (nearest-centroid): K={best[1]} → {best[0]:.0f}%")

    # trained softmax head (multinomial logistic) — learns discriminative boundaries, not just means
    from sklearn.linear_model import LogisticRegression
    Kd = best[1]
    lsi = TruncatedSVD(Kd, random_state=0); Dc = lsi.fit_transform(Xc)
    Dc /= (np.linalg.norm(Dc, axis=1, keepdims=True) + 1e-9)
    mask = np.isin(depts, ANCHOR_DEPTS)
    clf = LogisticRegression(max_iter=2000, C=4.0).fit(Dc[mask], depts[mask])
    tc = tn = 0
    for s, qtf in Qtf.items():
        q = lsi.transform(qtf); q /= (np.linalg.norm(q, axis=1, keepdims=True) + 1e-9)
        pred = clf.predict(q)
        tc += sum(1 for p in pred if p in SUBJECT_ACCEPT[s]); tn += len(pred)
    print(f"  trained softmax head (LogReg, K={Kd}): {100*tc//tn}%   ← learns boundaries vs means")


if __name__ == '__main__':
    main()
