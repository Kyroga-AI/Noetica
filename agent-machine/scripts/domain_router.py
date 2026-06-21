#!/usr/bin/env python3
"""
domain_router — the calibrated domain front-end, as a reusable component.

Replaces the failing LLM "which domain/law?" step. Fits domain anchors in the corpus topic
space (LSI), and routes a problem with a SOFTMAX over the anchors — returning the domain AND
a calibrated confidence. `gate()` abstains when confidence is low, so the verified-compute
engine only attempts what the router is sure of (and stops wasting LLM extraction on the rest).

  router = DomainRouter().fit_from_corpus()
  router.route("a 2 kg ball accelerates at 3 m/s^2 ...")   -> ('8', 0.71)   # physics, confident
  router.gate(text, min_conf=0.5)                          -> '8' or None   # None = abstain

Run:  python3 scripts/domain_router.py     # fit + demo on MMLU questions
"""
import os, sys, glob, json, pickle
import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer, ENGLISH_STOP_WORDS
from sklearn.decomposition import TruncatedSVD
from derive_topics import course_doc, dept, CORPUS, STOP
from reconcile_topics import SPOKEN

DEPT_NAME = {'18': 'mathematics', '8': 'physics', '5': 'chemistry', '7': 'biology',
             '6': 'eecs', '12': 'earth'}
DEFAULT_ANCHORS = ['18', '8', '5', '7', '6', '12']
CACHE = os.path.expanduser('~/.noetica/domain_router.pkl')


class DomainRouter:
    def __init__(self, k=60, anchors=None, temp=8.0):
        self.k, self.anchors, self.temp = k, anchors or DEFAULT_ANCHORS, temp

    def fit(self, docs, depts):
        depts = np.array(depts)
        stop = list(ENGLISH_STOP_WORDS | STOP | SPOKEN)
        self.tfv = TfidfVectorizer(stop_words=stop, token_pattern=r'[A-Za-z][A-Za-z]{3,}',
                                   min_df=8, max_df=0.3, max_features=15000).fit(docs)
        self.lsi = TruncatedSVD(self.k, random_state=0)
        D = self.lsi.fit_transform(self.tfv.transform(docs))
        D /= (np.linalg.norm(D, axis=1, keepdims=True) + 1e-9)
        self.A = np.array([(lambda a: a / (np.linalg.norm(a) + 1e-9))(D[depts == dp].mean(0))
                           for dp in self.anchors])
        return self

    def fit_from_corpus(self):
        docs, depts = [], []
        for d in sorted(glob.glob(CORPUS + '/*/')):
            slug, doc = course_doc(d)
            if len(doc) > 200:
                docs.append(doc); depts.append(dept(slug))
        return self.fit(docs, depts)

    def _embed(self, texts):
        q = self.lsi.transform(self.tfv.transform(texts))
        return q / (np.linalg.norm(q, axis=1, keepdims=True) + 1e-9)

    def route_batch(self, texts):
        e = np.exp((self._embed(texts) @ self.A.T) * self.temp)
        p = e / e.sum(1, keepdims=True)
        return [(self.anchors[i], float(p[r, i])) for r, i in enumerate(p.argmax(1))]

    def route(self, text):
        return self.route_batch([text])[0]

    def gate(self, text, min_conf=0.5):
        dp, c = self.route(text)
        return dp if c >= min_conf else None

    def save(self, path=CACHE):
        pickle.dump(self, open(path, 'wb')); return path


def main():
    print("# domain_router — fitting from corpus …")
    r = DomainRouter().fit_from_corpus()
    r.save()
    bank = json.load(open(os.path.expanduser('~/.noetica/corpus/benchmarks/mmlu_stem.json')))
    # demo: route a sample from a few subjects, show confidence + the abstain gate
    print(f"  fitted · anchors {[DEPT_NAME[d] for d in r.anchors]} · cached to {CACHE}\n")
    print(f"  {'subject':24} {'routed→':>10}  conf   gate(0.55)")
    print(f"  {'─'*24} {'─'*10}  {'─'*4}   {'─'*9}")
    for subj in ('college_physics', 'high_school_chemistry', 'college_biology',
                 'abstract_algebra', 'college_computer_science', 'astronomy'):
        q = bank[subj][3]['question']
        dp, c = r.route(q)
        g = r.gate(q, 0.55)
        print(f"  {subj:24} {DEPT_NAME[dp]:>10}  {c:.2f}   {'→'+DEPT_NAME[g] if g else 'ABSTAIN'}")
    # abstention trade-off: at higher confidence thresholds, accuracy on what's NOT abstained rises
    from collections import defaultdict
    ACC = {'college_physics': '8', 'high_school_chemistry': '5', 'college_biology': '7',
           'abstract_algebra': '18', 'college_computer_science': '6', 'electrical_engineering': '6',
           'high_school_physics': '8', 'college_chemistry': '5', 'high_school_biology': '7'}
    print(f"\n  abstention trade-off (selective routing):")
    for thr in (0.0, 0.4, 0.55, 0.7):
        kept = cor = 0
        for subj, exp in ACC.items():
            for it in bank[subj][:25]:
                dp, c = r.route(it['question'])
                if c >= thr:
                    kept += 1; cor += (dp == exp)
        print(f"    conf≥{thr:<4}  coverage {100*kept//(25*len(ACC)):>3}%   accuracy-on-routed {100*cor//max(kept,1):>3}%")


if __name__ == '__main__':
    main()
