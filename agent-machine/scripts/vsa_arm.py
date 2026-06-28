#!/usr/bin/env python3
"""vsa_arm — the MEASURED bench arm on top of the VSA/HRR substrate (scripts/vsa.py). Closes task #11:
the substrate existed, but was never wired into a scored board arm. This ENCODES the KBpedia/CSKG symbol
graph holographically — each grounded concept's vector = bundle over its CSKG edges of (relation ⊗ neighbor)
— so one 1024-d vector carries the concept's relational neighborhood. Then it scores an MCQ by the holographic
similarity between the question's concept-structure and each choice's: the choice whose grounded concepts share
the most RELATIONAL structure with the question wins. It ABSTAINS when the question touches no grounded concept
(honest coverage, like the compute arm) — so the ablation measures where structural binding actually helps.

  python3 scripts/vsa_arm.py            (self-test on the real CSKG bridge)
  python3 scripts/vsa_arm.py --batch    (JSONL {id,question,choices} on stdin → {id,answer,mode})
"""
import os, sys, re, json
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from vsa import hv, bind, bundle, sim, DIM, CleanupMemory  # the HRR substrate

LETTERS = ['A', 'B', 'C', 'D']
CANON = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'canon')

def _load_graph():
    """Holographic concept vectors from the CSKG bridge: concept ↦ bundle_e(REL_e ⊗ neighbor_e)."""
    p = os.path.join(CANON, 'symbol-commonsense.json')
    cs = json.load(open(p)) if os.path.exists(p) else {}
    role = {}; sym = {}                      # cached role + symbol hypervectors (deterministic by name)
    def rv(name, store):
        if name not in store: store[name] = hv(abs(hash(name)) % (2**31))
        return store[name]
    cvec = {}
    for concept, rec in cs.items():
        bound = []
        for e in rec.get('commonsense_edges', []):
            nb = e.get('neighbor_label') or e.get('target_label') or e.get('src_label')
            if nb:
                bound.append(bind(rv('REL:' + e['rel'], role), rv(nb, sym)))
        if bound:
            cvec[concept] = bundle(bound)
    return cvec

_GRAPH = None
def graph():
    global _GRAPH
    if _GRAPH is None: _GRAPH = _load_graph()
    return _GRAPH

def _concepts_in(text, cvec):
    """Grounded concepts whose label appears in the text (word-boundary)."""
    low = ' ' + re.sub(r'[^a-z0-9 ]+', ' ', text.lower()) + ' '
    return [c for c in cvec if (' ' + c.lower() + ' ') in low]

def score(question, choices):
    """VSA relational score: bundle the question's concept vectors, compare to each choice's bundle.
    Returns (letter or None, mode). Abstains when no grounded concept is present (honest coverage)."""
    cvec = graph()
    qc = _concepts_in(question, cvec)
    if not qc:
        return None, 'abstain'
    qv = bundle([cvec[c] for c in qc])
    best, bestsim = None, -2.0
    for i, ch in enumerate(choices):
        cc = _concepts_in(f'{question} {ch}', cvec)
        if not cc:
            continue
        s = sim(qv, bundle([cvec[c] for c in cc]))
        if s > bestsim:
            bestsim, best = s, i
    if best is None:
        return None, 'abstain'
    return LETTERS[best], f'vsa:{len(qc)}c'

def _batch():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            q = json.loads(line)
            ans, mode = score(q['question'], q['choices'])
        except Exception:
            q, ans, mode = {}, None, 'error'
        print(json.dumps({'id': q.get('id'), 'answer': ans, 'mode': mode}), flush=True)

def _selftest():
    print(f"# vsa_arm self-test (HRR DIM={DIM})\n")
    cvec = graph()
    print(f"holographically encoded {len(cvec)} concepts from the CSKG bridge")
    # holographic edge recovery: unbind a known relation from a concept, clean up to the neighbor
    if 'antigen' in cvec:
        role = {}; sym = {}
        rv = lambda n, st: st.setdefault(n, hv(abs(hash(n)) % (2**31)))
        # rebuild the cleanup over neighbor symbols
        from vsa import unbind
        cs = json.load(open(os.path.join(CANON, 'symbol-commonsense.json')))
        mem = CleanupMemory()
        nbset = set()
        for rec in cs.values():
            for e in rec.get('commonsense_edges', []):
                nb = e.get('neighbor_label') or e.get('target_label') or e.get('src_label')
                if nb: nbset.add(nb)
        for nb in nbset: mem.add(nb, hv(abs(hash(nb)) % (2**31)))
        got = mem.cleanup(unbind(cvec['antigen'], hv(abs(hash('REL:/r/Causes')) % (2**31))), 2)
        print(f"holographic edge recovery: antigen ⊘ /r/Causes → {got}")
    # a tiny scoring demo (will mostly abstain unless a grounded concept appears)
    demo = ('An antigen most directly causes the production of which of the following?',
            ['antibody', 'glucose', 'a vector space', 'dark matter'])
    print(f"\nscore demo: {score(demo[0], demo[1])}  (best-effort relational score; abstains w/o grounded concepts)")
    print(f"\n# arm ready: --batch mode scores MMLU choices by holographic graph structure; abstains honestly.")

if __name__ == '__main__':
    if '--batch' in sys.argv:
        _batch()
    else:
        _selftest()
