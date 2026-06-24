#!/usr/bin/env python3
"""
canon-keyvec-align — link the canon to PRE-TRAINED KEYED-VECTORS (fastText/GloVe via gensim) and use them to
align OUR topic decomposition to THEIR topics (the MMLU / MMLU-Pro subjects we're graded on). This is the
CONNECTIVE TISSUE between the canon-brain and the frontier tests.

Two embedding spaces, two jobs (do NOT conflate):
  • nomic (contextual)  → the BRAIN we retrieve against at answer time            (built elsewhere)
  • keyed-vecs (static) → this MAP: cluster concepts, match topic labels, decompose by what the test grades

What it produces (canon/keyvec-alignment.json + a printed summary):
  1. ALIGNMENT MATRIX     our canon-topic  ↔  their test-subject   (top-k cosine, "how the topic matches theirs")
  2. COVERAGE MAP         per test-subject: nearest canon topic + max cosine → low = a HOLE recovery must fill
  3. DECOMPOSITION        test-subject → [canon topics that cover it], a domain decomposition anchored to the eval

Keyed-vecs are great for proximity/clustering/label-match and weak for retrieval — so this is the MAP, not the
brain. Multi-word terms are handled by averaging their in-vocab word vectors (so OOV phrases still place).

Run:  MODEL=glove-wiki-gigaword-300 python3 scripts/canon-keyvec-align.py
      MODEL=fasttext-wiki-news-subwords-300 ...   (Facebook fastText — the 'keyed-vecs' of old; ~1GB)
"""
from __future__ import annotations
import os, re, json, glob, sys
import numpy as np

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CANON = os.path.join(HERE, 'canon')
MODEL = os.environ.get('MODEL', 'glove-wiki-gigaword-300')
TOPK = int(os.environ.get('TOPK', '3'))
COVERAGE_GAP = float(os.environ.get('COVERAGE_GAP', '0.45'))   # max-cosine below this = a coverage hole
_w = re.compile(r"[a-zA-Z][a-zA-Z'-]+")


def load_kv():
    import gensim.downloader as api
    print(f"# loading keyed-vecs: {MODEL}  (first run downloads to ~/gensim-data) ...", flush=True)
    kv = api.load(MODEL)
    print(f"  loaded · vocab={len(kv.index_to_key):,} · dim={kv.vector_size}", flush=True)
    return kv


class Embedder:
    """term/phrase -> unit vector by averaging in-vocab word vectors (OOV words skipped)."""
    def __init__(self, kv):
        self.kv = kv
        self.miss = 0; self.hit = 0

    def vec(self, text):
        toks = [t.lower() for t in _w.findall(text or '')]
        vs = []
        for t in toks:
            if t in self.kv:
                vs.append(self.kv[t]); self.hit += 1
            else:
                self.miss += 1
        if not vs:
            return None
        v = np.mean(vs, axis=0)
        n = np.linalg.norm(v)
        return v / n if n > 0 else None

    def centroid(self, texts):
        vs = [self.vec(t) for t in texts]
        vs = [v for v in vs if v is not None]
        if not vs:
            return None, 0
        v = np.mean(vs, axis=0); n = np.linalg.norm(v)
        return (v / n if n > 0 else None), len(vs)


# grade-LEVEL qualifiers are not TOPICS — they pollute a 2-3 word label centroid and wreck the match.
# (college_computer_science -> 'science' dragged it to physics). Strip them; keep real topic words.
_GRADE = {'college', 'high', 'school', 'elementary', 'conceptual', 'intro', 'introductory'}


def humanize(label):
    """'high_school_macroeconomics' -> 'macroeconomics' (drop grade level, keep the topic)."""
    words = [w for w in label.replace('_', ' ').split() if w.lower() not in _GRADE]
    return ' '.join(words) or label.replace('_', ' ')


def main():
    emb = Embedder(load_kv())

    # ── OUR side: a centroid per canon topic (topic name + subtopics + that topic's glossary terms) ──────────
    our_topics = []   # {domain, topic, level, n_terms, vec}
    for f in sorted(glob.glob(os.path.join(CANON, 'spec-*.json'))):
        spec = json.load(open(f)); dom = spec.get('domain') or os.path.basename(f)[5:-5]
        for t in spec.get('topics', []):
            texts = [t.get('topic', '')] + list(t.get('subtopics', []))
            texts += [g.get('term', '') for g in t.get('glossary', [])]
            v, n = emb.centroid(texts)
            if v is not None:
                our_topics.append({'domain': dom, 'topic': t.get('topic'), 'level': t.get('level'),
                                   'n_terms': n, 'vec': v})
    print(f"# our side: {len(our_topics)} canon-topic centroids "
          f"({sum(t['n_terms'] for t in our_topics)} terms placed)", flush=True)

    # ── THEIR side: a centroid per test subject (MMLU subjects + MMLU-Pro categories) ───────────────────────
    their = {}        # subject_label -> {kind, domain, vec}
    for f in sorted(glob.glob(os.path.join(CANON, 'spec-*.json'))):
        spec = json.load(open(f)); dom = spec.get('domain') or os.path.basename(f)[5:-5]
        pro = spec.get('mmlu_pro_category')
        if pro:
            v, _ = emb.centroid([humanize(pro)])
            if v is not None:
                their.setdefault(f'pro:{pro}', {'kind': 'mmlu_pro', 'domain': dom, 'vec': v})
        for s in spec.get('mmlu_subjects', []):
            v, _ = emb.centroid([humanize(s)])
            if v is not None:
                their.setdefault(f'mmlu:{s}', {'kind': 'mmlu', 'domain': dom, 'vec': v})
    print(f"# their side: {len(their)} test-subject centroids", flush=True)

    def cos(a, b):
        return float(np.dot(a, b))   # both unit vectors

    # ── 1. ALIGNMENT MATRIX: each canon topic -> its top-k nearest test subjects ─────────────────────────────
    alignment = []
    for ot in our_topics:
        sims = sorted(((cos(ot['vec'], d['vec']), lbl) for lbl, d in their.items()), reverse=True)[:TOPK]
        alignment.append({'domain': ot['domain'], 'topic': ot['topic'], 'level': ot['level'],
                          'matches': [{'subject': lbl, 'cos': round(c, 3)} for c, lbl in sims]})

    # ── 2. COVERAGE MAP: each test subject -> nearest canon topic + max cosine (low => a hole) ──────────────
    coverage = []
    for lbl, d in their.items():
        sims = sorted(((cos(ot['vec'], d['vec']), ot) for ot in our_topics), reverse=True)
        best_c, best = sims[0]
        coverage.append({'subject': lbl, 'kind': d['kind'], 'domain': d['domain'],
                         'max_cos': round(best_c, 3),
                         'nearest_topic': f"{best['domain']}:{best['topic']}",
                         'gap': best_c < COVERAGE_GAP})
    coverage.sort(key=lambda r: r['max_cos'])   # worst-covered first

    # ── 3. DECOMPOSITION: test subject -> the canon topics that cover it (the eval-anchored decomposition) ──
    decomposition = {}
    for lbl, d in their.items():
        sims = sorted(((cos(ot['vec'], d['vec']), ot) for ot in our_topics), reverse=True)
        decomposition[lbl] = [{'topic': f"{ot['domain']}:{ot['topic']}", 'cos': round(c, 3)}
                              for c, ot in sims[:6] if c >= COVERAGE_GAP]

    out = {'model': MODEL, 'vocab_hit': emb.hit, 'vocab_miss': emb.miss,
           'n_canon_topics': len(our_topics), 'n_test_subjects': len(their),
           'coverage_gap_threshold': COVERAGE_GAP,
           'alignment': alignment, 'coverage': coverage, 'decomposition': decomposition}
    op = os.path.join(CANON, 'keyvec-alignment.json')
    json.dump(out, open(op, 'w'), indent=1)

    # ── printed summary ─────────────────────────────────────────────────────────────────────────────────────
    print(f"\n# vocab placement: {emb.hit} hit / {emb.miss} miss "
          f"({100*emb.hit/max(1,emb.hit+emb.miss):.0f}% of canon terms have a keyed-vec)")
    gaps = [c for c in coverage if c['gap']]
    print(f"\n## COVERAGE vs the frontier tests  ({len(gaps)} holes < {COVERAGE_GAP} max-cosine):")
    for c in coverage[:10]:
        flag = '  <-- HOLE' if c['gap'] else ''
        print(f"  {c['subject']:34} max={c['max_cos']:.3f}  nearest={c['nearest_topic']}{flag}")
    print(f"\n## DECOMPOSITION sample (test subject -> canon topics that cover it):")
    for lbl in list(decomposition)[:4]:
        items = decomposition[lbl]
        chain = ', '.join(f"{i['topic'].split(':')[-1]}({i['cos']})" for i in items[:4]) or '(no canon topic above threshold — HOLE)'
        print(f"  {lbl:34} -> {chain}")
    print(f"\n# wrote {op}  ({len(alignment)} topic alignments, {len(coverage)} coverage rows)")


if __name__ == '__main__':
    main()
